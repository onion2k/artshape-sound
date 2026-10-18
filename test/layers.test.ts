// The layered sound under node: each kind of layer is rendered and read back from the samples (a spectrum's peaks, an
// envelope's e-fold, an onset's time, a pitch's glide) so that a layer is held to what it says it does, and the one
// door, checkLayered, is held to refusing each bad field by its path. Chance enters as a seeded source, so every
// number here is the same on every run.
import { describe, expect, it } from 'vitest';
import {
  checkLayered,
  isLayered,
  layeredSeconds,
  renderLayered,
  softClip,
  type Layer,
  type Layered,
} from '../src/layers';
import { MAX_SECONDS } from '../src/patch';
import { peak } from '../src/loudness';
import { coin } from '../src/patches';
import { render } from '../src/synth';
import { bandEnergy, crossingsPerSecond, magnitudeAt, onsetsOf, rmsOfDifference, seeded } from './helpers';

const SR = 48000;
// A quiet layer gain keeps tanh in its straight part, so a ratio read from the samples is the layer's own.
const QUIET = 0.05;
const sound = (layers: Layer[], more: Partial<Layered> = {}): Layered => ({ layers, volume: 0.5, ...more });
const draw = (s: Layered, seed = 1, rate = SR): Float32Array => renderLayered(s, rate, seeded(seed));
// The tallest sample in a window of seconds, which for a sine of a known period is its amplitude.
const peakIn = (s: Float32Array, from: number, to: number, rate = SR): number => {
  let top = 0;
  for (let i = Math.floor(from * rate); i < Math.min(s.length, Math.ceil(to * rate)); i++)
    top = Math.max(top, Math.abs(s[i]));
  return top;
};
const rmsIn = (s: Float32Array, from: number, to: number): number => {
  let sum = 0;
  const a = Math.floor(from * SR);
  const b = Math.min(s.length, Math.floor(to * SR));
  for (let i = a; i < b; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / (b - a));
};

describe('is a layered sound', () => {
  it('tells a Layered from a Patch by its layers', () => {
    expect(isLayered(sound([]))).toBe(true);
    expect(isLayered(coin)).toBe(false);
    expect(isLayered(null)).toBe(false);
    expect(isLayered('layers')).toBe(false);
  });
});

describe('the output as a whole', () => {
  const s = sound([{ kind: 'tone', at: 0.1, gain: 1, f: 440, decay: 0.05 }]);

  it('is exactly the length the layers add up to, at 44100 and at 48000, and ends at 0', () => {
    for (const rate of [44100, 48000]) {
      const out = draw(s, 1, rate);
      expect(out.length).toBe(Math.round(layeredSeconds(s) * rate));
      expect(out[out.length - 1]).toBe(0);
    }
  });

  it('peaks at its volume', () => {
    for (const volume of [0.2, 0.5, 1]) expect(peak(draw({ ...s, volume }))).toBeCloseTo(volume, 5);
  });

  it('is silent until a layer starts: a layer at 0.1 s is not heard before it', () => {
    expect(peakIn(draw(s), 0, 0.099)).toBe(0);
    expect(peakIn(draw(s), 0.1, 0.12)).toBeGreaterThan(0.1);
  });

  it('soft-clips: many loud layers stay inside the volume and finite', () => {
    const loud: Layer[] = Array.from({ length: 6 }, (_, i) => ({
      kind: 'tone',
      at: 0,
      gain: 10,
      f: 200 + 130 * i,
      decay: 0.1,
    }));
    const out = draw(sound(loud, { volume: 0.8 }));
    expect(peak(out)).toBeCloseTo(0.8, 5);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it('keeps a straight run straight where the sum is small', () => {
    // tanh at a gain of QUIET: the shape is the layer's, only the scale changes
    const a = draw(sound([{ kind: 'tone', at: 0, gain: QUIET, f: 300, decay: 0.05 }]));
    const b = draw(sound([{ kind: 'tone', at: 0, gain: 2 * QUIET, f: 300, decay: 0.05 }]));
    expect(rmsOfDifference(a, b)).toBeLessThan(0.002);
  });
});

describe('a tone layer', () => {
  it('is a sine at f, with its spectrum at f and not at its neighbours', () => {
    const out = draw(sound([{ kind: 'tone', at: 0, gain: QUIET, f: 1000, sustain: 0.3, decay: 0.05 }]));
    const at = magnitudeAt(out, SR, 1000, 0, 14400);
    expect(at).toBeGreaterThan(0.3);
    expect(magnitudeAt(out, SR, 2000, 0, 14400)).toBeLessThan(0.02 * at);
    expect(magnitudeAt(out, SR, 700, 0, 14400)).toBeLessThan(0.05 * at);
  });

  it('decays by e^-1 over its decay, read from its envelope', () => {
    const out = draw(sound([{ kind: 'tone', at: 0, gain: QUIET, f: 400, attack: 0.001, decay: 0.1 }]));
    const period = 1 / 400;
    // the envelope's first full-height wave, and the wave a decay later
    const first = peakIn(out, 0.002, 0.002 + period);
    const later = peakIn(out, 0.002 + 0.1, 0.002 + 0.1 + period);
    expect(later / first).toBeGreaterThan(Math.exp(-1) * 0.93);
    expect(later / first).toBeLessThan(Math.exp(-1) * 1.07);
  });

  it('holds its level for `sustain` before it decays', () => {
    const out = draw(sound([{ kind: 'tone', at: 0, gain: QUIET, f: 400, attack: 0.001, sustain: 0.2, decay: 0.05 }]));
    const a = peakIn(out, 0.01, 0.01 + 1 / 400);
    const b = peakIn(out, 0.18, 0.18 + 1 / 400);
    expect(b / a).toBeGreaterThan(0.97);
    expect(peakIn(out, 0.3, 0.3 + 1 / 400) / a).toBeLessThan(0.2);
  });

  it('glides from f to fEnd: higher at the start than at the end', () => {
    const out = draw(
      sound([{ kind: 'tone', at: 0, gain: QUIET, f: 800, fEnd: 200, glide: 0.05, sustain: 0.4, decay: 0.1 }]),
    );
    const early = crossingsPerSecond(out, SR, 0, 2400);
    const late = crossingsPerSecond(out, SR, 12000, 19200);
    // over the first 50 ms the pitch has fallen by the glide's first e-fold: an average near 580
    expect(early).toBeGreaterThan(500);
    expect(early).toBeGreaterThan(2 * late);
    expect(late).toBeGreaterThan(190);
    expect(late).toBeLessThan(260);
  });

  it('can be a square wave, which has the odd harmonics a sine has not', () => {
    const out = draw(sound([{ kind: 'tone', at: 0, gain: QUIET, wave: 'square', f: 500, sustain: 0.3, decay: 0.05 }]));
    const fundamental = magnitudeAt(out, SR, 500, 0, 14400);
    expect(magnitudeAt(out, SR, 1500, 0, 14400) / fundamental).toBeGreaterThan(0.25);
    expect(magnitudeAt(out, SR, 1000, 0, 14400) / fundamental).toBeLessThan(0.05);
  });

  it('wobbles its pitch with a vibrato, and its level with a tremolo', () => {
    const base = { kind: 'tone', at: 0, gain: QUIET, f: 600, sustain: 0.5, decay: 0.05 } as const;
    const plain = draw(sound([base]));
    const vib = draw(sound([{ ...base, vibrato: { rate: 6, depth: 0.05 } }]));
    expect(rmsOfDifference(plain, vib)).toBeGreaterThan(0.01);
    const trem = draw(sound([{ ...base, tremolo: { rate: 4, depth: 0.5 } }]));
    // a quarter period of a 4 Hz tremolo is 62 ms: the level there against the level half a period later
    const hi = peakIn(trem, 0.0625, 0.0625 + 1 / 600);
    const lo = peakIn(trem, 0.1875, 0.1875 + 1 / 600);
    expect(hi / lo).toBeGreaterThan(2);
  });

  it('is cut at `length`, faded over `release`', () => {
    const out = draw(sound([{ kind: 'tone', at: 0, gain: QUIET, f: 400, decay: 2, length: 0.2, release: 0.05 }]));
    expect(out.length).toBe(Math.round(0.2 * SR));
    expect(peakIn(out, 0.19, 0.2)).toBeLessThan(0.3 * peakIn(out, 0.1, 0.11));
  });
});

describe('a noise layer', () => {
  const lp = (fEnd?: number): Layered =>
    sound([{ kind: 'noise', at: 0, gain: QUIET, filter: 'lowpass', f: 1000, fEnd, sustain: 0.5, decay: 0.05 }]);

  it('through a lowpass has less energy above its corner than below', () => {
    const out = draw(lp());
    expect(bandEnergy(out, SR, 4000, 8000)).toBeLessThan(0.02 * bandEnergy(out, SR, 100, 800));
  });

  it('through a highpass has less below than above', () => {
    const out = draw(
      sound([{ kind: 'noise', at: 0, gain: QUIET, filter: 'highpass', f: 4000, sustain: 0.5, decay: 0.05 }]),
    );
    expect(bandEnergy(out, SR, 100, 1000)).toBeLessThan(0.02 * bandEnergy(out, SR, 5000, 9000));
  });

  it('through a bandpass keeps to its band', () => {
    const out = draw(
      sound([{ kind: 'noise', at: 0, gain: QUIET, filter: 'bandpass', f: 2000, q: 4, sustain: 0.5, decay: 0.05 }]),
    );
    expect(bandEnergy(out, SR, 300, 900)).toBeLessThan(0.05 * bandEnergy(out, SR, 1800, 2200, 20));
  });

  it('sweeps its corner from f to fEnd: the highs go', () => {
    const out = draw(sound([{ kind: 'noise', at: 0, gain: QUIET, f: 9000, fEnd: 400, sustain: 0.6, decay: 0.05 }]));
    const early = out.subarray(0, 6000);
    const late = out.subarray(24000, 30000);
    const highs = (s: Float32Array): number => bandEnergy(s, SR, 3000, 6000) / bandEnergy(s, SR, 100, 400);
    expect(highs(late)).toBeLessThan(0.1 * highs(early));
  });

  it('decays by e^-1 over its decay', () => {
    const out = draw(
      sound([{ kind: 'noise', at: 0, gain: QUIET, filter: 'bandpass', f: 800, q: 0.5, attack: 0.001, decay: 0.2 }]),
    );
    const a = rmsIn(out, 0.01, 0.03);
    const b = rmsIn(out, 0.21, 0.23);
    expect(b / a).toBeGreaterThan(Math.exp(-1) * 0.7);
    expect(b / a).toBeLessThan(Math.exp(-1) * 1.4);
  });

  it('can be steady, which holds the same level all along', () => {
    const out = draw(sound([{ kind: 'noise', at: 0, gain: QUIET, f: 500, steady: true, length: 1, release: 0.02 }]));
    expect(out.length).toBe(SR);
    expect(rmsIn(out, 0.1, 0.3) / rmsIn(out, 0.6, 0.9)).toBeGreaterThan(0.85);
    expect(rmsIn(out, 0.1, 0.3) / rmsIn(out, 0.6, 0.9)).toBeLessThan(1.15);
  });

  it('can gust: its level swells and falls with the gusts', () => {
    const out = draw(
      sound([
        {
          kind: 'noise',
          at: 0,
          gain: QUIET,
          f: 500,
          steady: true,
          length: 1,
          release: 0.01,
          gusts: [{ cycles: 2, depth: 0.7 }],
        },
      ]),
    );
    // the gusts' phase is drawn, so where the swell peaks is not fixed, but its depth is: the loudest twentieth of a
    // second against the quietest
    const levels = Array.from({ length: 18 }, (_, k) => rmsIn(out, 0.05 + k * 0.05, 0.1 + k * 0.05));
    expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(2);
  });

  it('brightens with the gusts: its corner rises when the gust does', () => {
    const out = draw(
      sound([
        {
          kind: 'noise',
          at: 0,
          gain: QUIET,
          f: 500,
          steady: true,
          length: 1,
          release: 0.01,
          gusts: [{ cycles: 1, depth: 0.8 }],
          gustPower: 0,
          gustBrighten: 3,
        },
      ]),
    );
    // one gust cycle in the second, its phase drawn: the brightest tenth of a second against the dullest
    const ratio = (k: number): number => {
      const part = out.subarray(Math.floor((0.05 + k * 0.1) * SR), Math.floor((0.15 + k * 0.1) * SR));
      return bandEnergy(part, SR, 1500, 3000) / bandEnergy(part, SR, 100, 400);
    };
    const ratios = Array.from({ length: 9 }, (_, k) => ratio(k));
    expect(Math.max(...ratios)).toBeGreaterThan(5 * Math.min(...ratios));
  });

  it('clamps a corner past the Nyquist as a patch clamps its cutoff', () => {
    const out = draw(sound([{ kind: 'noise', at: 0, gain: 1, f: 90000, sustain: 0.1, decay: 0.05 }]));
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(peak(out)).toBeCloseTo(0.5, 5);
  });
});

describe('a modes layer', () => {
  const list = [
    [1000, 0.2, 1],
    [2500, 0.2, 0.5],
    [4000, 0.2, 0.25],
  ] as [number, number, number][];
  const out = draw(sound([{ kind: 'modes', at: 0, gain: QUIET, modes: list }]));

  it('rings at each of its frequencies and at no other', () => {
    const peaks = list.map(([f]) => magnitudeAt(out, SR, f, 0, 14400));
    for (const f of [1500, 3100, 5500]) expect(magnitudeAt(out, SR, f, 0, 14400)).toBeLessThan(0.1 * peaks[2]);
    expect(peaks[1] / peaks[0]).toBeGreaterThan(0.4);
    expect(peaks[1] / peaks[0]).toBeLessThan(0.6);
    expect(peaks[2] / peaks[0]).toBeGreaterThan(0.2);
    expect(peaks[2] / peaks[0]).toBeLessThan(0.3);
  });

  it('decays each by e^-1 over its own decay', () => {
    const two = draw(
      sound([
        {
          kind: 'modes',
          at: 0,
          gain: QUIET,
          modes: [
            [500, 0.05, 1],
            [900, 0.2, 1],
          ],
        },
      ]),
    );
    const level = (hz: number, t: number): number =>
      magnitudeAt(two, SR, hz, Math.floor(t * SR), Math.floor((t + 0.01) * SR));
    expect(level(500, 0.06) / level(500, 0.01)).toBeLessThan(0.45);
    expect(level(900, 0.06) / level(900, 0.01)).toBeGreaterThan(0.7);
  });

  it('leaves out a mode at or past the Nyquist and renders the rest', () => {
    const o = draw(
      sound([
        {
          kind: 'modes',
          at: 0,
          gain: QUIET,
          modes: [
            [1000, 0.1, 1],
            [30000, 0.1, 1],
          ],
        },
      ]),
    );
    expect(magnitudeAt(o, SR, 1000, 0, 4800)).toBeGreaterThan(0.1);
    for (const v of o) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('an fm layer', () => {
  const s = sound([
    { kind: 'fm', at: 0, gain: QUIET, f: 500, ratio: 3, index: 4, indexDecay: 0.05, sustain: 0.6, decay: 0.2 },
  ]);
  const out = draw(s);

  it('has sidebands at f plus and minus ratio times f while the index is high, and none once it has fallen', () => {
    const side = (from: number, to: number): number =>
      magnitudeAt(out, SR, 500 + 1500, from, to) / magnitudeAt(out, SR, 500, from, to);
    expect(side(0, 2400)).toBeGreaterThan(0.3);
    expect(side(24000, 28800)).toBeLessThan(0.05);
  });

  it('keeps an index floor, so some sideband stays', () => {
    const floored = draw(sound([{ ...(s.layers[0] as object), indexFloor: 1.5 } as Layer]));
    const side = magnitudeAt(floored, SR, 2000, 24000, 28800) / magnitudeAt(floored, SR, 500, 24000, 28800);
    expect(side).toBeGreaterThan(0.2);
  });

  it('adds a bark at a ratio of its own that dies quickly', () => {
    const barked = draw(
      sound([{ ...(s.layers[0] as object), index: 0.1, bark: { ratio: 7, amount: 2, decay: 0.01 } } as Layer]),
    );
    const bark = (from: number, to: number): number => magnitudeAt(barked, SR, 500 * 7 + 500, from, to);
    expect(bark(0, 480)).toBeGreaterThan(5 * bark(9600, 10080));
  });
});

describe('a grains layer', () => {
  const s = sound([{ kind: 'grains', at: 0.1, gain: 1, count: 300, seconds: 0.4, f: 2800, q: 0.7 }]);
  const out = draw(s);

  it('keeps its grains inside [at, at + seconds] and a little tail, none before', () => {
    expect(peakIn(out, 0, 0.0999)).toBe(0);
    expect(peakIn(out, 0.1 + 0.4 + 0.06, 1)).toBe(0);
    expect(peakIn(out, 0.1, 0.5)).toBeGreaterThan(0.1);
  });

  it('is densest first: far more of it in the first third than the last', () => {
    // the grains also fall in loudness along the window, which alone is a ratio near 4 in rms; thinning them as well is
    // what takes it past 6
    expect(rmsIn(out, 0.1, 0.1 + 0.4 / 3)).toBeGreaterThan(6 * rmsIn(out, 0.1 + 0.8 / 3, 0.5));
  });

  it('is a band: more near its f than far from it', () => {
    expect(bandEnergy(out, SR, 2400, 3200, 50)).toBeGreaterThan(5 * bandEnergy(out, SR, 8000, 12000, 50));
  });

  it('draws a different scatter from another seed', () => {
    expect(Array.from(draw(s, 2))).not.toEqual(Array.from(out));
  });
});

describe('a claps layer', () => {
  const s = sound([{ kind: 'claps', at: 0.2, gain: QUIET * 10, seconds: 1.2, rate: 90 }]);
  const out = draw(s);

  it('puts every clap inside its window: none before `at`, none after it and the last burst', () => {
    expect(peakIn(out, 0, 0.1999)).toBe(0);
    expect(peakIn(out, 0.2 + 1.2 + 0.1, out.length / SR)).toBe(0);
    expect(peakIn(out, 0.2, 1.4)).toBeGreaterThan(0.1);
  });

  it('swells then dies: the first tenth of a second is quieter than the peak of the swell, and the end quieter still', () => {
    const early = rmsIn(out, 0.2, 0.25);
    const swell = rmsIn(out, 0.55, 0.75);
    const end = rmsIn(out, 1.3, 1.4);
    expect(swell).toBeGreaterThan(1.5 * early);
    expect(swell).toBeGreaterThan(2 * end);
  });

  it('is a crowd in the band between low and high', () => {
    expect(bandEnergy(out, SR, 1000, 2500, 100)).toBeGreaterThan(8 * bandEnergy(out, SR, 8000, 12000, 100));
    expect(bandEnergy(out, SR, 1000, 2500, 100)).toBeGreaterThan(8 * bandEnergy(out, SR, 100, 400, 25));
  });

  it('is a smaller or larger crowd with its rate', () => {
    const few = draw(sound([{ kind: 'claps', at: 0, gain: QUIET * 10, seconds: 1.2, rate: 8 }]));
    // more claps, more of them at once, so more energy per second in the swell
    expect(rmsIn(out, 0.55, 0.75)).toBeGreaterThan(1.5 * rmsIn(few, 0.35, 0.55));
  });
});

describe('a bubbles layer', () => {
  it('rises in pitch: a bubble is higher at its end than at its start', () => {
    const out = draw(
      sound([
        {
          kind: 'bubbles',
          at: 0,
          gain: QUIET,
          count: 1,
          spread: 0.0001,
          f: 800,
          ratio: 1,
          rise: 1.6,
          glide: 0.012,
          decay: 0.06,
        },
      ]),
    );
    const early = crossingsPerSecond(out, SR, 0, 480);
    const late = crossingsPerSecond(out, SR, 2400, 3600);
    expect(late).toBeGreaterThan(1.2 * early);
    expect(late).toBeLessThan(1.7 * 800);
  });

  it('scatters its onsets over `spread`: nothing before `at`, nothing long after the spread', () => {
    const out = draw(
      sound([{ kind: 'bubbles', at: 0.1, gain: QUIET, count: 30, spread: 0.3, f: 500, ratio: 4, decay: 0.02 }]),
    );
    expect(peakIn(out, 0, 0.0999)).toBe(0);
    expect(peakIn(out, 0.1, 0.4)).toBeGreaterThan(0.1);
    expect(peakIn(out, 0.1 + 0.3 + 0.5, out.length / SR)).toBe(0);
  });

  it('draws their pitches from f up to f times ratio', () => {
    const out = draw(
      sound([{ kind: 'bubbles', at: 0, gain: QUIET, count: 40, spread: 0.2, f: 500, ratio: 4, rise: 1, decay: 0.03 }]),
    );
    expect(bandEnergy(out, SR, 450, 2100, 50)).toBeGreaterThan(20 * bandEnergy(out, SR, 4000, 8000, 50));
  });
});

describe('a bounces layer', () => {
  const click: Layer = { kind: 'tone', at: 0, gain: 1, f: 2000, attack: 0.0005, decay: 0.002 };
  const bounces = (more: object = {}): Layered =>
    sound([
      {
        kind: 'bounces',
        at: 0,
        gain: QUIET,
        layers: [click],
        count: 4,
        gap: 0.1,
        shrink: 0.5,
        fade: 0.5,
        ...more,
      },
    ]);

  it('has its onsets at the shrinking gaps: 0, 0.1, 0.15, 0.175 s', () => {
    const out = draw(bounces());
    const threshold = 0.1 * peak(out);
    const onsets = onsetsOf(out, SR, threshold, 0.02);
    expect(onsets.length).toBe(4);
    [0, 0.1, 0.15, 0.175].forEach((t, i) => expect(Math.abs(onsets[i] - t)).toBeLessThan(0.002));
  });

  it('shrinks each by `fade`: the tops are in a ratio of the fade', () => {
    const out = draw(bounces());
    const tops = [0, 0.1, 0.15, 0.175].map((t) => peakIn(out, t, t + 0.005));
    for (let i = 1; i < 4; i++) expect(tops[i] / tops[i - 1]).toBeGreaterThan(0.47);
    for (let i = 1; i < 4; i++) expect(tops[i] / tops[i - 1]).toBeLessThan(0.53);
  });

  it('can scatter its gaps, from the seed and within the scatter', () => {
    const plain = onsetsOf(draw(bounces()), SR, 0.01, 0.02);
    const scattered = draw(bounces({ scatter: 0.3 }));
    const onsets = onsetsOf(scattered, SR, 0.1 * peak(scattered), 0.02);
    expect(onsets.length).toBe(4);
    expect(onsets).not.toEqual(plain);
    // the first gap is 0.1 s drawn within a third either way
    expect(onsets[1]).toBeGreaterThan(0.1 * 0.69);
    expect(onsets[1]).toBeLessThan(0.1 * 1.31);
    expect(Array.from(draw(bounces({ scatter: 0.3 })))).toEqual(Array.from(scattered));
  });

  it('plays the layers within it at an offset from each hit', () => {
    const out = draw(
      sound([
        {
          kind: 'bounces',
          at: 0.05,
          gain: QUIET,
          layers: [{ ...click, at: 0.03 }],
          count: 2,
          gap: 0.2,
          shrink: 1,
          fade: 1,
        },
      ]),
    );
    const onsets = onsetsOf(out, SR, 0.1 * peak(out), 0.02);
    expect(Math.abs(onsets[0] - 0.08)).toBeLessThan(0.002);
    expect(Math.abs(onsets[1] - 0.28)).toBeLessThan(0.002);
  });
});

describe('a patch layer', () => {
  it('is the v0.2 patch, rendered as it would be alone and scaled by the gain', () => {
    const alone = render(coin, SR, seeded(1));
    const out = draw(sound([{ kind: 'patch', at: 0, gain: QUIET, patch: coin }], { volume: coin.volume }));
    expect(out.length).toBe(alone.length);
    expect(rmsOfDifference(out, alone)).toBeLessThan(0.002);
  });

  it('starts at `at`', () => {
    const out = draw(sound([{ kind: 'patch', at: 0.25, gain: 1, patch: coin }]));
    expect(peakIn(out, 0, 0.2499)).toBe(0);
    expect(out.length).toBe(Math.round((0.25 + 0.25) * SR));
  });
});

describe('chance', () => {
  const rich = sound(
    [
      { kind: 'noise', at: 0, gain: 0.5, f: 2000, decay: 0.05 },
      { kind: 'tone', at: 0, gain: 0.5, f: 300, decay: 0.1 },
      { kind: 'grains', at: 0, gain: 0.5, count: 40, seconds: 0.1, f: 3000 },
    ],
    { jitter: 0.1 },
  );

  it('gives the same bits for the same sound and seed', () => {
    expect(Array.from(draw(rich, 7))).toEqual(Array.from(draw(rich, 7)));
  });

  it('gives other bits for another seed', () => {
    expect(Array.from(draw(rich, 8))).not.toEqual(Array.from(draw(rich, 7)));
  });

  it('draws a different take each time from one source, so variants differ', () => {
    const r = seeded(3);
    const a = renderLayered(rich, SR, r);
    const b = renderLayered(rich, SR, r);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('detunes the whole by `jitter`, once a render: a tone is at f only on a draw of one half', () => {
    const tone = sound([{ kind: 'tone', at: 0, gain: QUIET, f: 1000, sustain: 0.5, decay: 0.05 }], { jitter: 0.1 });
    const hz = (draw01: number): number =>
      crossingsPerSecond(
        renderLayered(tone, SR, () => draw01),
        SR,
      );
    expect(hz(0.5)).toBeCloseTo(1000, -1);
    expect(hz(1 - 1e-9)).toBeGreaterThan(1090);
    expect(hz(0)).toBeLessThan(910);
  });

  it('asks for no chance at all when there is none to use: a tone alone draws nothing', () => {
    const tone = sound([{ kind: 'tone', at: 0, gain: 1, f: 1000, decay: 0.05 }]);
    const never = (): number => {
      throw new Error('a tone drew chance');
    };
    expect(() => renderLayered(tone, SR, never)).not.toThrow();
  });

  it('is the same sound after a trip through JSON', () => {
    const copy = JSON.parse(JSON.stringify(rich)) as Layered;
    expect(Array.from(renderLayered(copy, SR, seeded(4)))).toEqual(Array.from(draw(rich, 4)));
  });
});

describe('the strikes of the game are expressible', () => {
  // The sketch's driver: a transient, the face's modes, a thump and the air of the follow-through.
  const driver = sound([
    { kind: 'noise', at: 0, gain: 0.8, filter: 'highpass', f: 3000, decay: 0.003 },
    {
      kind: 'modes',
      at: 0,
      gain: 1,
      modes: [
        [2900, 0.05, 0.22],
        [4300, 0.035, 0.16],
        [6100, 0.02, 0.1],
        [1550, 0.03, 0.1],
      ],
    },
    { kind: 'tone', at: 0, gain: 0.55, f: 210, fEnd: 120, glide: 0.02, decay: 0.028 },
    { kind: 'noise', at: 0.02, gain: 0.25, filter: 'bandpass', f: 700, fEnd: 2200, q: 1.3, attack: 0.06, decay: 0.12 },
  ]);

  it('passes its check and renders sound', () => {
    expect(checkLayered(driver)).toBeNull();
    const out = draw(driver);
    expect(peak(out)).toBeCloseTo(0.5, 5);
    expect(bandEnergy(out, SR, 2700, 3100, 50)).toBeGreaterThan(bandEnergy(out, SR, 9000, 12000, 50));
  });
});

describe('checkLayered', () => {
  const tone: Layer = { kind: 'tone', at: 0, gain: 1, f: 440, decay: 0.1 };
  const ok = (layers: unknown[], more: object = {}): unknown => ({ layers, volume: 0.5, ...more });

  it('accepts a sound that is sound', () => {
    expect(checkLayered(ok([tone]))).toBeNull();
    expect(checkLayered(ok([tone], { frequency: 440, jitter: 0.1 }))).toBeNull();
  });

  const bad: [string, unknown, string][] = [
    ['not an object', 7, 'layered sound must be an object'],
    ['an array', [], 'layered sound must be an object'],
    ['null', null, 'layered sound must be an object'],
    ['no layers list', { volume: 0.5 }, 'layers must be a list'],
    ['zero layers', ok([]), 'layers must be a list with at least one layer'],
    ['too many layers', ok(Array.from({ length: 65 }, () => tone)), 'layers'],
    ['volume above 1', ok([tone], { volume: 1.5 }), 'volume'],
    ['volume NaN', ok([tone], { volume: NaN }), 'volume'],
    ['frequency 0', ok([tone], { frequency: 0 }), 'frequency'],
    ['frequency infinite', ok([tone], { frequency: Infinity }), 'frequency'],
    ['jitter 0.9', ok([tone], { jitter: 0.9 }), 'jitter'],
    ['a layer that is not an object', ok([tone, 3]), 'layers[1] must be an object'],
    ['an unknown kind', ok([tone, { ...tone, kind: 'zap' }]), 'layers[1].kind'],
    ['a negative at', ok([{ ...tone, at: -1 }]), 'layers[0].at'],
    ['an at past the longest sound', ok([{ ...tone, at: 11 }]), 'layers[0].at'],
    ['a negative gain', ok([tone, { ...tone, gain: -1 }]), 'layers[1].gain'],
    ['an infinite gain', ok([{ ...tone, gain: Infinity }]), 'layers[0].gain'],
    ['a tone f of 0', ok([{ ...tone, f: 0 }]), 'layers[0].f'],
    ['a tone decay of 0', ok([{ ...tone, decay: 0 }]), 'layers[0].decay'],
    ['a tone fEnd below 0', ok([{ ...tone, fEnd: -3 }]), 'layers[0].fEnd'],
    ['a tone glide of 0', ok([{ ...tone, glide: 0 }]), 'layers[0].glide'],
    ['a tone attack below 0', ok([{ ...tone, attack: -0.1 }]), 'layers[0].attack'],
    ['a tone wave of noise', ok([{ ...tone, wave: 'noise' }]), 'layers[0].wave'],
    ['a vibrato depth past 1', ok([{ ...tone, vibrato: { rate: 5, depth: 2 } }]), 'layers[0].vibrato.depth'],
    ['a vibrato that is not an object', ok([{ ...tone, vibrato: 3 }]), 'layers[0].vibrato'],
    ['a tremolo rate below 0', ok([{ ...tone, tremolo: { rate: -1, depth: 0.2 } }]), 'layers[0].tremolo.rate'],
    ['a length of 0', ok([{ ...tone, length: 0 }]), 'layers[0].length'],
    ['a release below 0', ok([{ ...tone, release: -1 }]), 'layers[0].release'],
    ['a noise q of 0', ok([{ kind: 'noise', at: 0, gain: 1, f: 800, q: 0, decay: 0.1 }]), 'layers[0].q'],
    [
      'a noise filter that is not one',
      ok([{ kind: 'noise', at: 0, gain: 1, f: 800, filter: 'notch', decay: 0.1 }]),
      'layers[0].filter',
    ],
    ['a noise f of 0', ok([{ kind: 'noise', at: 0, gain: 1, f: 0, decay: 0.1 }]), 'layers[0].f'],
    ['a noise with no decay', ok([{ kind: 'noise', at: 0, gain: 1, f: 800 }]), 'layers[0].decay'],
    [
      'a steady noise with no length',
      ok([{ kind: 'noise', at: 0, gain: 1, f: 800, steady: true }]),
      'layers[0].length',
    ],
    [
      'a steady that is not a boolean',
      ok([{ kind: 'noise', at: 0, gain: 1, f: 800, decay: 1, steady: 1 }]),
      'layers[0].steady',
    ],
    [
      'gusts that add up to a silence',
      ok([
        {
          kind: 'noise',
          at: 0,
          gain: 1,
          f: 800,
          decay: 1,
          gusts: [
            { cycles: 1, depth: 0.6 },
            { cycles: 2, depth: 0.4 },
          ],
        },
      ]),
      'layers[0].gusts',
    ],
    [
      'a gust with 0 cycles',
      ok([
        {
          kind: 'noise',
          at: 0,
          gain: 1,
          f: 800,
          decay: 1,
          gusts: [
            { cycles: 1, depth: 0.2 },
            { cycles: 0, depth: 0.2 },
          ],
        },
      ]),
      'layers[0].gusts[1].cycles',
    ],
    [
      'gusts that are not a list',
      ok([{ kind: 'noise', at: 0, gain: 1, f: 800, decay: 1, gusts: 3 }]),
      'layers[0].gusts',
    ],
    [
      'a negative gustPower',
      ok([{ kind: 'noise', at: 0, gain: 1, f: 800, decay: 1, gustPower: -1 }]),
      'layers[0].gustPower',
    ],
    ['modes that are empty', ok([{ kind: 'modes', at: 0, gain: 1, modes: [] }]), 'layers[0].modes'],
    [
      'a mode that is not three numbers',
      ok([
        {
          kind: 'modes',
          at: 0,
          gain: 1,
          modes: [
            [100, 0.1, 1],
            [100, 0.1],
          ],
        },
      ]),
      'layers[0].modes[1]',
    ],
    [
      'a mode decay of 0',
      ok([
        {
          kind: 'modes',
          at: 0,
          gain: 1,
          modes: [
            [100, 0.1, 1],
            [200, 0, 1],
          ],
        },
      ]),
      'layers[0].modes[1][1]',
    ],
    ['a mode frequency of 0', ok([{ kind: 'modes', at: 0, gain: 1, modes: [[0, 0.1, 1]] }]), 'layers[0].modes[0][0]'],
    [
      'a mode amplitude below 0',
      ok([{ kind: 'modes', at: 0, gain: 1, modes: [[100, 0.1, -1]] }]),
      'layers[0].modes[0][2]',
    ],
    [
      'an fm ratio of 0',
      ok([{ kind: 'fm', at: 0, gain: 1, f: 200, ratio: 0, index: 1, indexDecay: 0.1, decay: 0.2 }]),
      'layers[0].ratio',
    ],
    [
      'an fm index below 0',
      ok([{ kind: 'fm', at: 0, gain: 1, f: 200, ratio: 1, index: -1, indexDecay: 0.1, decay: 0.2 }]),
      'layers[0].index',
    ],
    [
      'an fm indexDecay of 0',
      ok([{ kind: 'fm', at: 0, gain: 1, f: 200, ratio: 1, index: 1, indexDecay: 0, decay: 0.2 }]),
      'layers[0].indexDecay',
    ],
    [
      'an fm bark decay of 0',
      ok([
        {
          kind: 'fm',
          at: 0,
          gain: 1,
          f: 200,
          ratio: 1,
          index: 1,
          indexDecay: 0.1,
          decay: 0.2,
          bark: { ratio: 5, amount: 1, decay: 0 },
        },
      ]),
      'layers[0].bark.decay',
    ],
    ['grains of none', ok([{ kind: 'grains', at: 0, gain: 1, count: 0, seconds: 0.1, f: 2000 }]), 'layers[0].count'],
    [
      'grains not whole',
      ok([{ kind: 'grains', at: 0, gain: 1, count: 2.5, seconds: 0.1, f: 2000 }]),
      'layers[0].count',
    ],
    [
      'grains over no time',
      ok([{ kind: 'grains', at: 0, gain: 1, count: 10, seconds: 0, f: 2000 }]),
      'layers[0].seconds',
    ],
    [
      'grains with a q of 0',
      ok([{ kind: 'grains', at: 0, gain: 1, count: 10, seconds: 0.1, f: 2000, q: 0 }]),
      'layers[0].q',
    ],
    ['claps at a rate of 0', ok([{ kind: 'claps', at: 0, gain: 1, seconds: 1, rate: 0 }]), 'layers[0].rate'],
    ['claps over no time', ok([{ kind: 'claps', at: 0, gain: 1, seconds: 0, rate: 10 }]), 'layers[0].seconds'],
    ['claps in no bands', ok([{ kind: 'claps', at: 0, gain: 1, seconds: 1, rate: 10, bands: 0 }]), 'layers[0].bands'],
    [
      'claps in too many bands',
      ok([{ kind: 'claps', at: 0, gain: 1, seconds: 1, rate: 10, bands: 17 }]),
      'layers[0].bands',
    ],
    [
      'claps with low above high',
      ok([{ kind: 'claps', at: 0, gain: 1, seconds: 1, rate: 10, low: 3000, high: 1000 }]),
      'layers[0].high',
    ],
    ['too many claps', ok([{ kind: 'claps', at: 0, gain: 1, seconds: 9, rate: 5000 }]), 'layers[0].rate'],
    ['bubbles of none', ok([{ kind: 'bubbles', at: 0, gain: 1, count: 0, spread: 0.1, f: 500 }]), 'layers[0].count'],
    [
      'bubbles with a ratio below 1',
      ok([{ kind: 'bubbles', at: 0, gain: 1, count: 3, spread: 0.1, f: 500, ratio: 0.5 }]),
      'layers[0].ratio',
    ],
    [
      'bubbles over no spread',
      ok([{ kind: 'bubbles', at: 0, gain: 1, count: 3, spread: 0, f: 500 }]),
      'layers[0].spread',
    ],
    [
      'bounces of none',
      ok([{ kind: 'bounces', at: 0, gain: 1, layers: [tone], count: 0, gap: 0.1, shrink: 0.5, fade: 0.5 }]),
      'layers[0].count',
    ],
    [
      'bounces with a shrink of 0',
      ok([{ kind: 'bounces', at: 0, gain: 1, layers: [tone], count: 3, gap: 0.1, shrink: 0, fade: 0.5 }]),
      'layers[0].shrink',
    ],
    [
      'bounces with a fade past 1',
      ok([{ kind: 'bounces', at: 0, gain: 1, layers: [tone], count: 3, gap: 0.1, shrink: 0.5, fade: 2 }]),
      'layers[0].fade',
    ],
    [
      'bounces with a gap of 0',
      ok([{ kind: 'bounces', at: 0, gain: 1, layers: [tone], count: 3, gap: 0, shrink: 0.5, fade: 0.5 }]),
      'layers[0].gap',
    ],
    [
      'bounces with no layers',
      ok([{ kind: 'bounces', at: 0, gain: 1, layers: [], count: 3, gap: 0.1, shrink: 0.5, fade: 0.5 }]),
      'layers[0].layers',
    ],
    [
      'bounces inside bounces',
      ok([
        {
          kind: 'bounces',
          at: 0,
          gain: 1,
          layers: [{ kind: 'bounces', at: 0, gain: 1, layers: [tone], count: 2, gap: 0.1, shrink: 1, fade: 1 }],
          count: 2,
          gap: 0.1,
          shrink: 1,
          fade: 1,
        },
      ]),
      'layers[0].layers[0].kind',
    ],
    [
      'a bad layer inside bounces',
      ok([
        {
          kind: 'bounces',
          at: 0,
          gain: 1,
          layers: [tone, { ...tone, decay: 0 }],
          count: 2,
          gap: 0.1,
          shrink: 1,
          fade: 1,
        },
      ]),
      'layers[0].layers[1].decay',
    ],
    [
      'a patch layer with a bad patch',
      ok([{ kind: 'patch', at: 0, gain: 1, patch: { ...coin, cutoff: 0 } }]),
      'layers[0].patch: cutoff',
    ],
    ['a patch layer with no patch', ok([{ kind: 'patch', at: 0, gain: 1 }]), 'layers[0].patch'],
    ['a total past MAX_SECONDS', ok([{ ...tone, sustain: 9, decay: 1 }]), `more than ${MAX_SECONDS}`],
    ['a layer that ends past MAX_SECONDS', ok([{ ...tone, at: 8, decay: 1 }]), 'layers[0]'],
  ];

  for (const [what, value, expected] of bad) {
    it(`refuses ${what}, naming ${expected}`, () => {
      const problem = checkLayered(value);
      expect(problem, `no problem found for ${what}`).not.toBeNull();
      expect(problem).toContain(expected);
    });
  }
});

describe('renderLayered refuses what it cannot make, by name', () => {
  it('a bad sound, by its field', () => {
    expect(() => draw({ layers: [], volume: 0.5 })).toThrow(/renderLayered: layers must be a list/);
  });

  it('a tone at or past the Nyquist, by its path', () => {
    const s = sound([{ kind: 'tone', at: 0, gain: 1, f: 30000, decay: 0.1 }]);
    expect(() => draw(s)).toThrow(/layers\[0\]\.f.*Nyquist/);
    expect(() => draw(sound([{ kind: 'tone', at: 0, gain: 1, f: 23000, decay: 0.1 }]), 1, 44100)).toThrow(/Nyquist/);
  });

  it('a sample rate that is not a rate', () => {
    expect(() => draw(sound([{ kind: 'tone', at: 0, gain: 1, f: 100, decay: 0.1 }]), 1, 0)).toThrow(/sampleRate/);
  });

  it('a jittered tone that the draw would take past the Nyquist', () => {
    const s = sound([{ kind: 'tone', at: 0, gain: 1, f: 20000, decay: 0.1 }], { jitter: 0.5 });
    expect(() => renderLayered(s, SR, () => 1 - 1e-9)).toThrow(/Nyquist/);
  });
});

describe('the length of a layered sound', () => {
  it('is the latest end of any layer, with `at` and the tail of each', () => {
    const s = sound([
      { kind: 'tone', at: 0, gain: 1, f: 440, decay: 0.1, attack: 0.01 },
      { kind: 'tone', at: 0.5, gain: 1, f: 440, decay: 0.1, attack: 0.01, length: 0.3 },
    ]);
    expect(layeredSeconds(s)).toBeCloseTo(0.8, 12);
    const long = sound([{ kind: 'tone', at: 0.5, gain: 1, f: 440, decay: 0.1, attack: 0.01 }]);
    expect(layeredSeconds(long)).toBeCloseTo(0.5 + 0.01 + 0.7, 12);
  });

  it('includes the last bounce of a bounces layer', () => {
    const click: Layer = { kind: 'tone', at: 0, gain: 1, f: 2000, length: 0.01, decay: 0.002 };
    const s = sound([{ kind: 'bounces', at: 0, gain: 1, layers: [click], count: 3, gap: 0.2, shrink: 1, fade: 1 }]);
    expect(layeredSeconds(s)).toBeCloseTo(0.4 + 0.01, 12);
  });
});

describe('softClip', () => {
  it('is tanh to within a few hundredths, and bounded by 1', () => {
    for (let x = -8; x <= 8; x += 0.01) {
      expect(Math.abs(softClip(x) - Math.tanh(x)), `x = ${x}`).toBeLessThan(0.025);
      expect(Math.abs(softClip(x))).toBeLessThanOrEqual(1);
    }
  });

  it('is odd, rises all the way, and has no step where its rational part meets its ceiling', () => {
    expect(softClip(0)).toBe(0);
    let last = -1;
    for (let x = -6; x <= 6; x += 0.001) {
      const y = softClip(x);
      expect(y).toBeGreaterThanOrEqual(last);
      expect(softClip(-x)).toBeCloseTo(-softClip(x), 12);
      last = y;
    }
    expect(Math.abs(softClip(3 + 1e-9) - softClip(3 - 1e-9))).toBeLessThan(1e-6);
  });

  it('is nearly straight for small values, so a quiet layer keeps its shape', () => {
    expect(softClip(0.05) / 0.05).toBeGreaterThan(0.999);
  });
});
