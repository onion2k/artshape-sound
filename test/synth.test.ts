import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PATCH, type Patch } from '../src/patch';
import { peak, rms } from '../src/loudness';
import { duration, render } from '../src/synth';
import { crossingsPerSecond, rmsOfDifference, seeded } from './helpers';

const SR = 44100;
// A plain tone with a flat envelope: the sustain is all there is, bar a few samples either end to avoid a click.
const tone = (changes: Partial<Patch> = {}): Patch => ({
  ...DEFAULT_PATCH,
  wave: 'sine',
  frequency: 440,
  attack: 0.005,
  sustain: 1,
  release: 0.005,
  volume: 1,
  ...changes,
});

afterEach(() => vi.restoreAllMocks());

describe('duration and length', () => {
  it('is attack, sustain and release added together', () => {
    expect(duration(tone({ attack: 0.1, sustain: 0.25, release: 0.4 }))).toBeCloseTo(0.75, 9);
  });

  it('gives exactly duration * sampleRate samples, rounded to the nearest, at 44100 and 48000', () => {
    for (const sr of [44100, 48000]) {
      for (const [a, s, r] of [
        [0.01, 0.2, 0.1],
        [0, 0.123, 0],
        [0.0001, 0.00003, 0],
        [0.333, 0.333, 0.333],
      ] as const) {
        const p = tone({ attack: a, sustain: s, release: r });
        expect(render(p, sr, seeded(1)).length).toBe(Math.round(duration(p) * sr));
      }
    }
  });

  it('is not the same number of samples at the two rates', () => {
    const p = tone();
    expect(render(p, 48000, seeded(1)).length).toBeGreaterThan(render(p, 44100, seeded(1)).length);
  });

  it('refuses a patch checkPatch refuses, naming the field', () => {
    expect(() => render(tone({ cutoff: 0 }), SR)).toThrow(/cutoff/);
    expect(() => render(tone({ attack: 0, sustain: 0, release: 0 }), SR)).toThrow(/sustain/);
  });

  it('refuses a frequency at or past the Nyquist, naming it', () => {
    expect(() => render(tone({ frequency: 24000 }), 48000)).toThrow(/frequency/);
    expect(() => render(tone({ frequency: 30000 }), SR)).toThrow(/frequency/);
    expect(() => render(tone({ frequency: 20000 }), SR)).not.toThrow();
  });

  it('refuses a sample rate that is not a positive number', () => {
    expect(() => render(tone(), 0)).toThrow(/sampleRate/);
    expect(() => render(tone(), NaN)).toThrow(/sampleRate/);
  });
});

describe('level and ends', () => {
  it('peaks at the patch volume, whatever the wave', () => {
    for (const wave of ['sine', 'square', 'saw', 'triangle', 'noise'] as const) {
      const out = render(tone({ wave, volume: 0.6, punch: 0.5, noise: 0.3 }), SR, seeded(3));
      expect(peak(out), wave).toBeCloseTo(0.6, 5);
    }
  });

  it('is silent at the last sample, and never NaN or past 1', () => {
    for (const wave of ['sine', 'square', 'saw', 'triangle', 'noise'] as const) {
      const out = render(tone({ wave, release: 0 }), SR, seeded(3));
      expect(out[out.length - 1]).toBe(0);
      expect(out.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
    }
  });

  it('is all zeros at volume 0', () => {
    expect(peak(render(tone({ volume: 0 }), SR))).toBe(0);
  });

  it('fades in over the attack and out over the release', () => {
    const out = render(tone({ attack: 0.1, sustain: 0.1, release: 0.1 }), SR);
    const n = Math.round(0.1 * SR);
    expect(peak(out.subarray(0, n >> 3))).toBeLessThan(0.2);
    expect(peak(out.subarray(n, 2 * n))).toBeGreaterThan(0.99);
    expect(peak(out.subarray(out.length - (n >> 3)))).toBeLessThan(0.2);
  });
});

describe('the waves', () => {
  it('reads a sine back at its frequency by zero crossings, within 1%', () => {
    for (const f of [110, 440, 1760]) {
      const out = render(tone({ frequency: f }), SR);
      const hz = crossingsPerSecond(out, SR, SR >> 3, out.length - (SR >> 3));
      expect(Math.abs(hz - f) / f, `${f} Hz read as ${hz}`).toBeLessThan(0.01);
    }
  });

  it('holds the frequency at 48000 too', () => {
    const out = render(tone({ frequency: 440 }), 48000);
    expect(Math.abs(crossingsPerSecond(out, 48000, 6000, out.length - 6000) - 440) / 440).toBeLessThan(0.01);
  });

  it('gives square, saw and triangle the same pitch as the sine, with a different shape', () => {
    const sine = render(tone(), SR);
    for (const wave of ['square', 'saw', 'triangle'] as const) {
      const out = render(tone({ wave }), SR);
      const hz = crossingsPerSecond(out, SR, SR >> 3, out.length - (SR >> 3));
      expect(Math.abs(hz - 440) / 440, wave).toBeLessThan(0.01);
      expect(rmsOfDifference(out, sine), wave).toBeGreaterThan(0.05);
    }
    // A square wave spends its time at the extremes, so its rms is the highest of the four.
    expect(rms(render(tone({ wave: 'square' }), SR))).toBeGreaterThan(rms(sine));
  });

  it('makes noise that has no clear pitch and takes its chance from random', () => {
    const a = render(tone({ wave: 'noise' }), SR, seeded(1));
    const b = render(tone({ wave: 'noise' }), SR, seeded(2));
    expect(rmsOfDifference(a, b)).toBeGreaterThan(0.1);
  });
});

describe('slide', () => {
  it('moves the pitch, up for positive and down for negative, in Hz per second', () => {
    const half = SR >> 1;
    const up = render(tone({ frequency: 300, slide: 400 }), SR);
    const first = crossingsPerSecond(up, SR, 0, half);
    const second = crossingsPerSecond(up, SR, half, up.length);
    expect(second).toBeGreaterThan(first * 1.3);
    // Centred on the middle of each half: 300 + 400 * 0.25 and 300 + 400 * 0.75.
    expect(Math.abs(first - 400) / 400).toBeLessThan(0.05);
    expect(Math.abs(second - 600) / 600).toBeLessThan(0.05);

    const down = render(tone({ frequency: 800, slide: -400 }), SR);
    expect(crossingsPerSecond(down, SR, half, down.length)).toBeLessThan(crossingsPerSecond(down, SR, 0, half) * 0.8);
  });

  it('is stopped at silence when it would go below 0 Hz, not run backwards', () => {
    const out = render(tone({ frequency: 100, slide: -1000 }), SR);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    // After 0.1 s the tone is at 0 Hz, which is a constant, so the last half second has no crossings.
    expect(crossingsPerSecond(out, SR, SR >> 1, out.length)).toBe(0);
  });
});

describe('punch', () => {
  it('raises the first peak above the sustain’s later ones', () => {
    const p = tone({ attack: 0, sustain: 0.5, release: 0.01, punch: 1 });
    const out = render(p, SR);
    const n = Math.round(0.05 * SR);
    const early = peak(out.subarray(0, n));
    const late = peak(out.subarray(Math.round(0.4 * SR), Math.round(0.45 * SR)));
    expect(early).toBeGreaterThan(late * 2);
  });

  it('does nothing at 0', () => {
    const out = render(tone({ attack: 0, sustain: 0.5, release: 0.01, punch: 0 }), SR);
    const n = Math.round(0.05 * SR);
    expect(peak(out.subarray(0, n)) / peak(out.subarray(Math.round(0.4 * SR), Math.round(0.45 * SR)))).toBeCloseTo(
      1,
      1,
    );
  });
});

describe('cutoff', () => {
  const saw = (changes: Partial<Patch>): Patch => tone({ wave: 'saw', frequency: 220, ...changes });
  // How rough a signal is: the rms of its first difference, over its own rms. A lowpass makes it smaller.
  const roughness = (s: Float32Array): number => {
    const d = new Float32Array(s.length - 1);
    for (let i = 1; i < s.length; i++) d[i - 1] = s[i] - s[i - 1];
    return rms(d) / rms(s);
  };

  it('changes the sound more the lower it is, measured by the rms of the difference from an unfiltered render', () => {
    const open = render(saw({}), SR);
    const high = rmsOfDifference(render(saw({ cutoff: 18000 }), SR), open);
    const mid = rmsOfDifference(render(saw({ cutoff: 1500 }), SR), open);
    const low = rmsOfDifference(render(saw({ cutoff: 300 }), SR), open);
    // The filter still smears the saw's one sharp edge a little, so "almost nothing" is measured at about 0.02.
    expect(high).toBeLessThan(0.03);
    expect(mid).toBeGreaterThan(high * 3);
    expect(low).toBeGreaterThan(mid);
  });

  it('lowers the energy above it, so the signal is smoother', () => {
    const open = roughness(render(saw({}), SR));
    expect(roughness(render(saw({ cutoff: 1000 }), SR))).toBeLessThan(open * 0.6);
    expect(roughness(render(saw({ cutoff: 250 }), SR))).toBeLessThan(open * 0.3);
    // Two poles roll off at 12 dB an octave: a single pole measures 0.070 here and two measure 0.051.
    expect(roughness(render(saw({ cutoff: 1000 }), SR))).toBeLessThan(0.06);
  });

  it('is no filter at all at Infinity: the same bits as the same patch built without it', () => {
    const a = render(saw({ cutoff: Infinity }), SR);
    const b = render({ ...saw({}), cutoff: Infinity }, SR);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(rmsOfDifference(a, render(saw({ cutoff: 5000 }), SR))).toBeGreaterThan(0);
  });

  it('opens with cutoffSlide, so the end is brighter than the start', () => {
    const out = render(saw({ cutoff: 200, cutoffSlide: 4000, attack: 0, release: 0 }), SR);
    const q = out.length >> 2;
    expect(roughness(out.subarray(out.length - q, out.length - 1))).toBeGreaterThan(
      roughness(out.subarray(0, q)) * 1.5,
    );
  });
});

describe('vibrato', () => {
  it('wanders the pitch around its centre at the vibrato rate', () => {
    const out = render(tone({ vibratoDepth: 100, vibratoRate: 4 }), SR);
    const win = SR >> 3;
    const rates: number[] = [];
    for (let at = SR >> 3; at + win < out.length - (SR >> 3); at += win)
      rates.push(crossingsPerSecond(out, SR, at, at + win));
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(100);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(Math.abs(mean - 440) / 440).toBeLessThan(0.05);
  });

  it('is nothing at depth 0, whatever the rate', () => {
    const a = render(tone({ vibratoDepth: 0, vibratoRate: 9 }), SR);
    expect(Array.from(a)).toEqual(Array.from(render(tone(), SR)));
  });
});

describe('noise', () => {
  it('mixes chance into a tone, more the higher it is', () => {
    const clean = render(tone(), SR, seeded(1));
    const some = rmsOfDifference(render(tone({ noise: 0.2 }), SR, seeded(1)), clean);
    const lots = rmsOfDifference(render(tone({ noise: 0.8 }), SR, seeded(1)), clean);
    expect(some).toBeGreaterThan(0.05);
    expect(lots).toBeGreaterThan(some);
  });

  it('is the same samples for the same seed, and different for another', () => {
    const p = tone({ noise: 0.5 });
    const a = render(p, SR, seeded(7));
    expect(Array.from(render(p, SR, seeded(7)))).toEqual(Array.from(a));
    expect(rmsOfDifference(render(p, SR, seeded(8)), a)).toBeGreaterThan(0.05);
  });

  it('asks for no chance at all when there is none to use, so a plain tone never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    render(tone(), SR);
    render(tone({ jitter: 0, noise: 0 }), SR);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('repeat', () => {
  // The levels of a rectified signal over short windows: a pulse is a run of windows above a threshold.
  const pulses = (s: Float32Array): number => {
    const win = Math.round(SR * 0.002);
    const top = peak(s);
    let count = 0;
    let on = false;
    for (let at = 0; at + win <= s.length; at += win) {
      const level = peak(s.subarray(at, at + win));
      if (!on && level > top * 0.5) {
        count++;
        on = true;
      } else if (on && level < top * 0.15) on = false;
    }
    return count;
  };
  const pulsed = (repeat: number): Patch => tone({ attack: 0.05, sustain: 0.55, release: 0.4, repeat });

  it('gives that many onsets in a second: once, and 3, 5 and 8 times', () => {
    expect(pulses(render(pulsed(0), SR))).toBe(1);
    for (const n of [3, 5, 8]) expect(pulses(render(pulsed(n), SR)), `${n} Hz`).toBe(n);
  });

  it('keeps the length the same, and ends silent', () => {
    const out = render(pulsed(5), SR);
    expect(out.length).toBe(SR);
    expect(out[out.length - 1]).toBe(0);
  });

  it('restarts the pitch with each onset, so a falling slide starts high again', () => {
    const out = render(
      tone({ frequency: 1000, slide: -1000, attack: 0.02, sustain: 0.8, release: 0.18, repeat: 2 }),
      SR,
    );
    const win = SR >> 3;
    const startOfSecondPulse = crossingsPerSecond(out, SR, SR >> 1, (SR >> 1) + win);
    const endOfFirstPulse = crossingsPerSecond(out, SR, (SR >> 1) - win, SR >> 1);
    expect(startOfSecondPulse).toBeGreaterThan(endOfFirstPulse * 1.5);
  });
});

describe('jitter', () => {
  const jittery = tone({ jitter: 0.5 });

  it('is the same samples for the same seed, and different for another', () => {
    const a = render(jittery, SR, seeded(11));
    expect(Array.from(render(jittery, SR, seeded(11)))).toEqual(Array.from(a));
    expect(rmsOfDifference(render(jittery, SR, seeded(12)), a)).toBeGreaterThan(0.1);
  });

  it('draws once per render, moves the start frequency by at most the fraction, and nothing else', () => {
    let calls = 0;
    const lowest = () => (calls++, 0);
    const out = render(jittery, SR, lowest);
    expect(calls).toBe(1);
    // A draw of 0 is the bottom of the range: 440 * (1 - 0.5) = 220 Hz.
    const hz = crossingsPerSecond(out, SR, SR >> 3, out.length - (SR >> 3));
    expect(Math.abs(hz - 220) / 220).toBeLessThan(0.01);
    const highest = render(jittery, SR, () => 1);
    expect(Math.abs(crossingsPerSecond(highest, SR, SR >> 3, highest.length - (SR >> 3)) - 660) / 660).toBeLessThan(
      0.01,
    );
  });

  it('is exactly the unjittered sound when the draw is in the middle', () => {
    expect(Array.from(render(jittery, SR, () => 0.5))).toEqual(Array.from(render(tone(), SR)));
  });

  it('takes its chance from Math.random when none is given, each time and not once for good', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    render(jittery, SR);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockReturnValue(1);
    render(jittery, SR);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('sounds different from one render to the next with no random given', () => {
    expect(rmsOfDifference(render(jittery, SR), render(jittery, SR))).toBeGreaterThan(0);
  });

  it('does not call the supplied random when jitter and noise are both 0', () => {
    const random = vi.fn(() => 0.3);
    render(tone(), SR, random);
    expect(random).not.toHaveBeenCalled();
  });
});

describe('the same seed gives the same run', () => {
  it('is bit for bit across calls with every field in play', () => {
    const p: Patch = {
      wave: 'saw',
      frequency: 330,
      slide: 200,
      attack: 0.02,
      sustain: 0.2,
      release: 0.1,
      punch: 0.7,
      volume: 0.9,
      cutoff: 2000,
      cutoffSlide: 500,
      vibratoDepth: 20,
      vibratoRate: 6,
      noise: 0.2,
      repeat: 4,
      jitter: 0.2,
    };
    expect(Array.from(render(p, SR, seeded(5)))).toEqual(Array.from(render(p, SR, seeded(5))));
  });
});

describe('src/ keeps clocks and global chance out', () => {
  // Comments may talk about the names; only code is held to this.
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const forbidden = /Math\.random|Date\.now|performance\.now|new Date\(/g;

  it('finds no Math.random, Date.now or performance.now, bar the one documented fallback in synth.ts', () => {
    const found: string[] = [];
    for (const file of readdirSync('src').filter((f) => f.endsWith('.ts'))) {
      for (const match of code(readFileSync(`src/${file}`, 'utf8')).matchAll(forbidden))
        found.push(`${file}: ${match[0]}`);
    }
    expect(found).toEqual(['synth.ts: Math.random']);
  });
});
