// A layered sound rendered as a loop, under node: a buffer of exactly the length asked that comes round without a
// step at its seam, its tails wrapped over its start, its beds spanning the whole of it, and its slow swells dividing
// it. What would make a loop click is read from the samples: the step from the last sample to the first, against the
// largest step inside.
import { describe, expect, it } from 'vitest';
import { MAX_LOOP_SECONDS, renderLoop, type Layer, type Layered } from '../src/layers';
import { peak } from '../src/loudness';
import { seeded } from './helpers';

const SR = 48000;
const bed = (more: Partial<Extract<Layer, { kind: 'noise' }>> = {}): Layer => ({
  kind: 'noise',
  at: 0,
  gain: 1,
  f: 400,
  steady: true,
  length: 1,
  gusts: [
    { cycles: 2, depth: 0.45 },
    { cycles: 5, depth: 0.35 },
  ],
  gustBrighten: 1.5,
  ...more,
});
const sound = (layers: Layer[], more: Partial<Layered> = {}): Layered => ({ layers, volume: 0.6, ...more });
const loop = (s: Layered, seconds = 2, seed = 1, rate = SR): Float32Array => renderLoop(s, seconds, rate, seeded(seed));
const rmsIn = (s: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) sum += s[i] * s[i];
  return Math.sqrt(sum / (Math.round(to * SR) - Math.round(from * SR)));
};
const seam = (x: Float32Array): { across: number; inside: number } => {
  let inside = 0;
  for (let i = 1; i < x.length; i++) inside = Math.max(inside, Math.abs(x[i] - x[i - 1]));
  return { across: Math.abs(x[0] - x[x.length - 1]), inside };
};

describe('renderLoop', () => {
  it('is exactly the length asked for, at 44100 and at 48000, and peaks at the volume', () => {
    for (const rate of [44100, 48000]) {
      const x = loop(sound([bed()]), 2.5, 1, rate);
      expect(x.length).toBe(Math.round(2.5 * rate));
      expect(peak(x)).toBeCloseTo(0.6, 5);
    }
  });

  it('comes round without a step at the seam: the filter starts where its end leaves it', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { across, inside } = seam(loop(sound([bed()]), 2, seed));
      expect(across, `seed ${seed}`).toBeLessThanOrEqual(inside);
    }
  });

  it('makes a bed of a steady noise whatever its `at` and `length` say: it spans the loop', () => {
    const x = loop(sound([bed({ at: 0.7, length: 0.3, gusts: undefined })]), 3);
    expect(rmsIn(x, 0, 0.5)).toBeGreaterThan(0.05);
    expect(rmsIn(x, 2.4, 2.9)).toBeGreaterThan(0.05);
    expect(rmsIn(x, 2.4, 2.9) / rmsIn(x, 0, 0.5)).toBeGreaterThan(0.7);
    expect(rmsIn(x, 2.4, 2.9) / rmsIn(x, 0, 0.5)).toBeLessThan(1.4);
  });

  it('swells with its gusts, a whole number of times over the loop', () => {
    const x = loop(sound([bed({ gusts: [{ cycles: 3, depth: 0.7 }] })]), 3);
    const levels = Array.from({ length: 30 }, (_, k) => rmsIn(x, k * 0.1, k * 0.1 + 0.1));
    expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(2);
    // three swells over thirty tenths: the level has three crests, counted as the times it climbs through its middle
    const middle = (Math.max(...levels) + Math.min(...levels)) / 2;
    let rises = 0;
    for (let k = 0; k < levels.length; k++) if (levels[(k + 1) % 30] >= middle && levels[k] < middle) rises++;
    expect(rises).toBe(3);
  });

  it('wraps a tail that runs past the end over the start', () => {
    const ring: Layer = { kind: 'tone', at: 1.8, gain: 1, f: 500, sustain: 0.4, decay: 0.05, length: 0.4 };
    const x = loop(sound([ring]), 2);
    // the tone starts 0.2 s before the end and lasts 0.4: 0.2 s of it comes round to the start
    expect(rmsIn(x, 0, 0.18)).toBeGreaterThan(0.05);
    expect(rmsIn(x, 0.25, 1.7)).toBe(0);
    const plain = loop(sound([{ ...ring, at: 0.2 }]), 2);
    expect(rmsIn(plain, 0, 0.18)).toBe(0);
  });

  it('does not end on 0, being a loop and not a sound', () => {
    let nonzero = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const x = loop(sound([bed()]), 1, seed);
      if (x[x.length - 1] !== 0) nonzero++;
    }
    expect(nonzero).toBeGreaterThan(0);
  });

  it('is the same bits for a seed, and others for another', () => {
    const a = loop(sound([bed()]), 1, 4);
    expect(Array.from(loop(sound([bed()]), 1, 4))).toEqual(Array.from(a));
    expect(Array.from(loop(sound([bed()]), 1, 5))).not.toEqual(Array.from(a));
  });

  it('may hold layers of any kind beside the bed, soft-clipped together', () => {
    const x = loop(
      sound([
        bed(),
        { kind: 'grains', at: 0.5, gain: 2, count: 200, seconds: 0.4, f: 3000 },
        { kind: 'claps', at: 1, gain: 1, seconds: 0.5, rate: 40 },
      ]),
      2,
    );
    expect(peak(x)).toBeCloseTo(0.6, 5);
    for (const v of x) expect(Number.isFinite(v)).toBe(true);
  });

  it('refuses a gust that is not a whole number of cycles, naming it', () => {
    expect(() => loop(sound([bed({ gusts: [{ cycles: 2.5, depth: 0.3 }] })]))).toThrow(
      /layers\[0\]\.gusts\[0\]\.cycles.*whole/,
    );
  });

  it('refuses a layer that starts at or after the end of the loop, naming it', () => {
    expect(() => loop(sound([bed(), { kind: 'tone', at: 2, gain: 1, f: 300, decay: 0.1 }]), 2)).toThrow(
      /layers\[1\]\.at/,
    );
  });

  it('refuses a length that is not above 0 or past the longest loop, by name', () => {
    for (const seconds of [0, -1, NaN, Infinity, MAX_LOOP_SECONDS + 1])
      expect(() => loop(sound([bed()]), seconds), String(seconds)).toThrow(/renderLoop: seconds must be from/);
  });

  it('refuses a bad sound by the path of its field, and a bad sample rate', () => {
    expect(() => loop(sound([bed({ q: 0 })]))).toThrow(/renderLoop: layers\[0\]\.q/);
    expect(() => loop(sound([bed()]), 1, 1, 0)).toThrow(/sampleRate/);
  });

  it('refuses a tone at or past the Nyquist, by path, as renderLayered does', () => {
    expect(() => loop(sound([bed(), { kind: 'tone', at: 0, gain: 1, f: 30000, decay: 0.1 }]))).toThrow(
      /layers\[1\]\.f.*Nyquist/,
    );
  });
});
