// The reverb's impulse response under node: noise under an exponential decay, pure and seeded like the synth. The
// audio test of the whole graph, in test/reverb.audio.test.ts, holds what the convolver makes of it.

import { describe, expect, it } from 'vitest';
import { impulse } from '../src/reverb';
import { rms } from '../src/loudness';
import { seeded } from './helpers';

const SR = 48000;

describe('impulse', () => {
  it('is Math.round(seconds * sampleRate) samples long', () => {
    expect(impulse(0.5, 3, SR, seeded(1)).length).toBe(24000);
    expect(impulse(0.3, 3, 44100, seeded(1)).length).toBe(13230);
  });

  it('decays: the last tenth is far quieter than the first', () => {
    const s = impulse(1, 5, SR, seeded(2));
    const tenth = s.length / 10;
    expect(rms(s.subarray(s.length - tenth))).toBeLessThan(rms(s.subarray(0, tenth)) / 10);
  });

  it('is noise that stays inside [-1, 1] and is not silent', () => {
    const s = impulse(0.5, 3, SR, seeded(3));
    expect(rms(s)).toBeGreaterThan(0.05);
    for (const v of s) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it('gives the same bytes for the same seed and different bytes for another', () => {
    const a = impulse(0.5, 3, SR, seeded(4));
    expect(Array.from(impulse(0.5, 3, SR, seeded(4)))).toEqual(Array.from(a));
    expect(Array.from(impulse(0.5, 3, SR, seeded(5)))).not.toEqual(Array.from(a));
  });

  it('draws from the random it is given, one draw a sample, and not from the global source', () => {
    let draws = 0;
    impulse(0.1, 3, SR, () => {
      draws++;
      return 0.7;
    });
    expect(draws).toBe(4800);
  });

  it('refuses a length, a decay or a rate that makes no impulse, by name', () => {
    expect(() => impulse(0, 3, SR, seeded(1))).toThrow(/seconds/);
    expect(() => impulse(0.5, -1, SR, seeded(1))).toThrow(/decay/);
    expect(() => impulse(0.5, 3, 0, seeded(1))).toThrow(/sampleRate/);
  });
});
