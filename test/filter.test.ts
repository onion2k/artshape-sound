// The biquad under node: what a lowpass, a highpass and a bandpass do to noise, read from the samples with Goertzel
// bins; that the sweep moves the corner; that a loop's warm start comes round; and that no corner or Q makes NaN.
import { describe, expect, it } from 'vitest';
import { biquad } from '../src/filter';
import { peak } from '../src/loudness';
import { bandEnergy, seeded } from './helpers';

const SR = 48000;
const noise = (n: number, seed = 1): Float32Array => {
  const r = seeded(seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 2 * r() - 1;
  return x;
};

describe('biquad', () => {
  it('lowpass: less energy above its corner than below', () => {
    const x = biquad(noise(SR), SR, { type: 'lowpass', f: 1000 });
    expect(bandEnergy(x, SR, 4000, 8000)).toBeLessThan(0.01 * bandEnergy(x, SR, 100, 800));
  });

  it('highpass: less energy below its corner than above', () => {
    const x = biquad(noise(SR), SR, { type: 'highpass', f: 4000 });
    expect(bandEnergy(x, SR, 100, 1000)).toBeLessThan(0.01 * bandEnergy(x, SR, 5000, 9000));
  });

  it('bandpass: most of its energy near its centre', () => {
    const x = biquad(noise(SR), SR, { type: 'bandpass', f: 2000, q: 4 });
    const near = bandEnergy(x, SR, 1800, 2200);
    expect(bandEnergy(x, SR, 200, 800)).toBeLessThan(0.05 * near);
    expect(bandEnergy(x, SR, 6000, 12000)).toBeLessThan(0.05 * near);
  });

  it('sweeps the corner exponentially from f to fEnd', () => {
    const n = SR;
    const x = biquad(noise(n), SR, { type: 'lowpass', f: 8000, fEnd: 500 });
    const early = x.subarray(0, n / 8);
    const late = x.subarray(n - n / 8);
    // the late part has lost the highs the early part had
    const high = (s: Float32Array) => bandEnergy(s, SR, 3000, 6000) / bandEnergy(s, SR, 100, 400);
    expect(high(late)).toBeLessThan(0.05 * high(early));
  });

  it('works in place and returns the same array', () => {
    const x = noise(1000);
    expect(biquad(x, SR, { type: 'lowpass', f: 1000 })).toBe(x);
  });

  it('is the same bits for the same input', () => {
    const a = biquad(noise(5000), SR, { type: 'bandpass', f: 1500, fEnd: 700, q: 2 });
    const b = biquad(noise(5000), SR, { type: 'bandpass', f: 1500, fEnd: 700, q: 2 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('clamps a corner at or past the Nyquist, and one near 0, and stays finite', () => {
    for (const f of [0, 1, 30000, 1e9]) {
      for (const type of ['lowpass', 'highpass', 'bandpass'] as const) {
        const x = biquad(noise(4000), SR, { type, f, q: 50 });
        expect(Number.isFinite(peak(x)), `${type} at ${f}`).toBe(true);
        expect(peak(x), `${type} at ${f}`).toBeLessThan(1000);
      }
    }
  });

  it('follows a corner function given per sample', () => {
    const x = biquad(noise(SR), SR, { type: 'lowpass', f: 1000, corner: (i) => (i < SR / 2 ? 400 : 8000) });
    const first = x.subarray(0, SR / 2 - 200);
    const second = x.subarray(SR / 2 + 2000);
    expect(bandEnergy(second, SR, 3000, 6000)).toBeGreaterThan(20 * bandEnergy(first, SR, 3000, 6000));
  });

  it('warm: starts from the state the end of the buffer leaves, so a loop comes round', () => {
    const n = 20000;
    const source = noise(n, 3);
    const cold = biquad(source.slice(), SR, { type: 'lowpass', f: 300 });
    const warm = biquad(source.slice(), SR, { type: 'lowpass', f: 300, warm: 4096 });
    // the seam: the step from the last sample to the first, against the steps inside
    let inside = 0;
    for (let i = 1; i < n; i++) inside = Math.max(inside, Math.abs(warm[i] - warm[i - 1]));
    expect(Math.abs(warm[0] - warm[n - 1])).toBeLessThan(2 * inside);
    // a cold start begins from rest, so it is not the same buffer
    expect(warm[0]).not.toBe(cold[0]);
  });

  it('an empty buffer is left alone', () => {
    expect(biquad(new Float32Array(0), SR, { type: 'lowpass', f: 1000 }).length).toBe(0);
  });
});
