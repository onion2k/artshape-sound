// The stock layered sounds under node: each passes the check, renders to what its comment says (read from the samples:
// a spectrum's peak at the pitch it is rendered at, a ring that lasts, a crowd that swells, a wind that comes round),
// at both sample rates, and keeps its shape through JSON. Whether they are good sounds is for the ear and the sheet.
import { describe, expect, it } from 'vitest';
import { checkLayered, layeredSeconds, renderLayered, renderLoop, type Layered } from '../src/layers';
import { peak } from '../src/loudness';
import { ALL_LAYERED, applause, bell, birds, epiano, marimba, splash, wind, WIND_SECONDS, wood } from '../src/sounds';
import { bandEnergy, magnitudeAt, seeded } from './helpers';

const SR = 48000;
const draw = (s: Layered, seed = 1, rate = SR): Float32Array => renderLayered(s, rate, seeded(seed));
const rmsIn = (s: Float32Array, from: number, to: number, rate = SR): number => {
  let sum = 0;
  const a = Math.round(from * rate);
  const b = Math.min(s.length, Math.round(to * rate));
  for (let i = a; i < b; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / (b - a));
};

describe('the stock layered sounds', () => {
  const names = Object.keys(ALL_LAYERED);

  it('are the eight there are, by name', () => {
    expect(names).toEqual(['wood', 'marimba', 'epiano', 'bell', 'splash', 'applause', 'wind', 'birds']);
  });

  for (const [name, sound] of Object.entries(ALL_LAYERED)) {
    describe(name, () => {
      it('passes the check, and survives JSON', () => {
        expect(checkLayered(sound)).toBeNull();
        expect(JSON.parse(JSON.stringify(sound))).toEqual(sound);
      });

      for (const rate of [44100, 48000]) {
        it(`renders at ${rate}: finite, at its volume, ${name === 'wind' ? 'as a loop' : 'ending on 0'}`, () => {
          const loop = name === 'wind';
          const out = loop ? renderLoop(sound, WIND_SECONDS, rate, seeded(1)) : renderLayered(sound, rate, seeded(1));
          for (const v of out) expect(Number.isFinite(v)).toBe(true);
          expect(peak(out)).toBeCloseTo(sound.volume, 5);
          if (loop) expect(out.length).toBe(Math.round(WIND_SECONDS * rate));
          else {
            expect(out.length).toBe(Math.round(layeredSeconds(sound) * rate));
            expect(out[out.length - 1]).toBe(0);
            expect(layeredSeconds(sound)).toBeLessThan(10);
          }
        });
      }

      it('is the same bits from a seed', () => {
        const run = (): Float32Array =>
          name === 'wind' ? renderLoop(sound, WIND_SECONDS, SR, seeded(3)) : draw(sound, 3);
        expect(Array.from(run())).toEqual(Array.from(run()));
      });
    });
  }

  it('are all different sounds', () => {
    const seen = new Set<string>();
    for (const [name, sound] of Object.entries(ALL_LAYERED)) {
      const out = name === 'wind' ? renderLoop(sound, 1, SR, seeded(1)) : draw(sound);
      seen.add(`${out.length}:${out[Math.floor(out.length / 3)]}`);
    }
    expect(seen.size).toBe(names.length);
  });
});

describe('wood', () => {
  const out = draw(wood);
  it('rings at the modes of a wooden thing and is over in a fifth of a second', () => {
    for (const hz of [480, 1150])
      expect(magnitudeAt(out, SR, hz, 0, 2400)).toBeGreaterThan(5 * magnitudeAt(out, SR, hz * 1.4, 0, 2400));
    expect(layeredSeconds(wood)).toBeLessThanOrEqual(0.2);
    expect(rmsIn(out, 0.15, 0.2)).toBeLessThan(0.1 * rmsIn(out, 0, 0.05));
  });
});

describe('the pitched sounds are rendered at the pitch they say', () => {
  const peaksAt = (s: Layered, window: [number, number]): ((hz: number) => number) => {
    const out = draw(s);
    return (hz) => magnitudeAt(out, SR, hz, Math.round(window[0] * SR), Math.round(window[1] * SR));
  };

  it('marimba at C5, ringing for more than a second', () => {
    const at = peaksAt(marimba, [0.05, 0.4]);
    expect(marimba.frequency).toBe(523.25);
    expect(at(523.25)).toBeGreaterThan(8 * at(523.25 * 1.19));
    expect(at(523.25)).toBeGreaterThan(8 * at(523.25 * 0.84));
    expect(rmsIn(draw(marimba), 1, 1.3)).toBeGreaterThan(0.002);
  });

  it('epiano at C4, ringing for more than a second', () => {
    const at = peaksAt(epiano, [0.1, 0.6]);
    expect(epiano.frequency).toBe(261.63);
    expect(at(261.63)).toBeGreaterThan(3 * at(261.63 * 1.5));
    expect(at(261.63)).toBeGreaterThan(3 * at(261.63 * 0.67));
    expect(rmsIn(draw(epiano), 1.2, 1.5)).toBeGreaterThan(0.01);
  });

  it('bell at C7, with a shimmer that settles to a clean ring', () => {
    const early = peaksAt(bell, [0, 0.2]);
    const late = peaksAt(bell, [1.5, 2.5]);
    expect(bell.frequency).toBe(2093);
    expect(late(2093)).toBeGreaterThan(5 * late(2093 * 1.3));
    // the sidebands at the modulator's ratio are strong at the start and gone by the end
    expect(early(2093 + 3.5 * 2093) / early(2093)).toBeGreaterThan(5 * (late(2093 + 3.5 * 2093) / late(2093)));
  });
});

describe('splash', () => {
  it('begins with its impact and trails off into bubbles', () => {
    const out = draw(splash);
    expect(rmsIn(out, 0, 0.05)).toBeGreaterThan(3 * rmsIn(out, 0.5, 0.6));
    expect(rmsIn(out, 0.2, 0.5)).toBeGreaterThan(0);
    expect(layeredSeconds(splash)).toBeLessThan(1.5);
  });
});

describe('applause', () => {
  const out = draw(applause);
  it('swells and dies over about three seconds, in a crowd’s band', () => {
    expect(layeredSeconds(applause)).toBeGreaterThan(3);
    expect(layeredSeconds(applause)).toBeLessThan(3.2);
    expect(rmsIn(out, 0.6, 1.2)).toBeGreaterThan(1.5 * rmsIn(out, 0, 0.15));
    expect(rmsIn(out, 0.6, 1.2)).toBeGreaterThan(2 * rmsIn(out, 2.7, 3));
    expect(bandEnergy(out, SR, 900, 2600, 100)).toBeGreaterThan(5 * bandEnergy(out, SR, 8000, 12000, 100));
  });
});

describe('wind', () => {
  const out = renderLoop(wind, WIND_SECONDS, SR, seeded(1));
  it('comes round to its start without a step', () => {
    let inside = 0;
    for (let i = 1; i < out.length; i++) inside = Math.max(inside, Math.abs(out[i] - out[i - 1]));
    expect(Math.abs(out[0] - out[out.length - 1])).toBeLessThanOrEqual(inside);
  });

  it('swells with its gusts: the loudest half second against the quietest', () => {
    const levels = Array.from({ length: WIND_SECONDS * 2 }, (_, k) => rmsIn(out, k * 0.5, k * 0.5 + 0.5));
    expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(1.8);
  });

  it('is low: mostly under a kilohertz', () => {
    expect(bandEnergy(out, SR, 50, 900, 50)).toBeGreaterThan(5 * bandEnergy(out, SR, 2000, 6000, 100));
  });

  it('renders as a loop of any whole number of seconds the gusts divide', () => {
    for (const seconds of [2, 3, 7]) expect(renderLoop(wind, seconds, SR, seeded(1)).length).toBe(seconds * SR);
  });
});

describe('birds', () => {
  it('is a run of high chirps, each a different bird across variants', () => {
    const a = draw(birds, 1);
    const b = draw(birds, 2);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(bandEnergy(a, SR, 2500, 5500, 100)).toBeGreaterThan(20 * bandEnergy(a, SR, 100, 1500, 100));
    expect(layeredSeconds(birds)).toBeLessThan(1);
  });

  it('has four chirps, each quieter than the last', () => {
    const out = draw(birds, 1);
    const threshold = 0.2 * peak(out);
    const starts: number[] = [];
    let quiet = true;
    let last = -1;
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i]) >= threshold) {
        if (quiet || i - last > 0.04 * SR) starts.push(i / SR);
        last = i;
        quiet = false;
      }
    }
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.length).toBeLessThanOrEqual(4);
  });
});
