import { describe, expect, it } from 'vitest';
import { normalise, peak, rms } from '../src/loudness';

describe('peak', () => {
  it('is the largest magnitude, whichever way it points', () => {
    expect(peak(Float32Array.of(0.25, -0.75, 0.5))).toBeCloseTo(0.75, 6);
    expect(peak(Float32Array.of(0.9, -0.1))).toBeCloseTo(0.9, 6);
  });
  it('is 0 for silence and for nothing', () => {
    expect(peak(new Float32Array(8))).toBe(0);
    expect(peak(new Float32Array(0))).toBe(0);
  });
});

describe('rms', () => {
  it('is the root of the mean square', () => {
    expect(rms(Float32Array.of(3, -3, 3, -3))).toBeCloseTo(3, 6);
    expect(rms(Float32Array.of(1, 0, 0, 0))).toBeCloseTo(0.5, 6);
  });
  it('is 0 for nothing, not NaN', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('normalise', () => {
  it('scales so the peak is the target', () => {
    const out = normalise(Float32Array.of(0.1, -0.2, 0.05), 0.8);
    expect(peak(out)).toBeCloseTo(0.8, 6);
    expect(out[0]).toBeCloseTo(0.4, 6);
    expect(out[1]).toBeCloseTo(-0.8, 6);
  });
  it('leaves its input alone', () => {
    const input = Float32Array.of(0.1, -0.2);
    normalise(input, 1);
    expect(Array.from(input)).toEqual([Float32Array.of(0.1)[0], Float32Array.of(-0.2)[0]]);
  });
  it('gives silence back as silence, never NaN', () => {
    const out = normalise(new Float32Array(4), 0.9);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
  it('turns a loud signal down as well as a quiet one up', () => {
    expect(peak(normalise(Float32Array.of(4, -2), 0.5))).toBeCloseTo(0.5, 6);
  });
});
