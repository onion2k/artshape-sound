import { describe, expect, it } from 'vitest';
import { DEFAULT_PATCH, checkPatch, type Patch } from '../src/patch';

const bad = (changes: Record<string, unknown>): string | null => checkPatch({ ...DEFAULT_PATCH, ...changes });

describe('checkPatch', () => {
  it('accepts the default patch, and a cutoff of Infinity', () => {
    expect(checkPatch(DEFAULT_PATCH)).toBeNull();
    expect(DEFAULT_PATCH.cutoff).toBe(Infinity);
  });

  it('refuses what is not an object', () => {
    for (const v of [null, undefined, 3, 'sine', [DEFAULT_PATCH]]) expect(checkPatch(v)).toMatch(/patch/);
  });

  it('refuses a missing field by its name', () => {
    for (const key of Object.keys(DEFAULT_PATCH)) {
      const p: Record<string, unknown> = { ...DEFAULT_PATCH };
      delete p[key];
      expect(checkPatch(p), key).toContain(key);
    }
  });

  // One row per field: a value that is out of range, so that the message has to name that field and no other.
  const refused: [keyof Patch, unknown][] = [
    ['wave', 'sawtooth'],
    ['wave', 3],
    ['frequency', 0],
    ['frequency', -440],
    ['frequency', NaN],
    ['frequency', Infinity],
    ['frequency', '440'],
    ['slide', NaN],
    ['slide', Infinity],
    ['attack', -0.01],
    ['sustain', -1],
    ['release', NaN],
    ['attack', 11],
    ['punch', -0.1],
    ['punch', 1.1],
    ['volume', -0.1],
    ['volume', 1.5],
    ['cutoff', 0],
    ['cutoff', -100],
    ['cutoff', NaN],
    ['cutoffSlide', NaN],
    ['vibratoDepth', -1],
    ['vibratoRate', -1],
    ['vibratoRate', NaN],
    ['noise', -0.1],
    ['noise', 2],
    ['repeat', -1],
    ['repeat', Infinity],
    ['repeat', 2e6],
    ['jitter', -0.5],
    ['jitter', 1.01],
  ];
  for (const [field, value] of refused) {
    it(`refuses ${field} = ${String(value)}, naming ${field}`, () => {
      const message = bad({ [field]: value });
      expect(message).not.toBeNull();
      expect(message).toContain(field);
    });
  }

  it('refuses an envelope of nothing, naming attack, sustain and release', () => {
    const message = bad({ attack: 0, sustain: 0, release: 0 });
    expect(message).toContain('attack');
    expect(message).toContain('sustain');
    expect(message).toContain('release');
  });

  it('accepts one envelope stage on its own, and the edges of the ranges', () => {
    expect(bad({ attack: 0, sustain: 0.1, release: 0 })).toBeNull();
    expect(bad({ punch: 0, volume: 0, noise: 0, jitter: 0 })).toBeNull();
    expect(bad({ punch: 1, volume: 1, noise: 1, jitter: 1 })).toBeNull();
    expect(bad({ cutoff: 0.001, slide: -5000, cutoffSlide: -5000 })).toBeNull();
  });

  it('accepts every wave in the list', () => {
    for (const wave of ['sine', 'square', 'saw', 'triangle', 'noise']) expect(bad({ wave })).toBeNull();
  });

  it('survives a round trip through JSON for everything but Infinity', () => {
    const p = { ...DEFAULT_PATCH, cutoff: 900 };
    expect(checkPatch(JSON.parse(JSON.stringify(p)))).toBeNull();
  });
});
