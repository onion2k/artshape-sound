import { describe, expect, it } from 'vitest';
import * as stock from '../src/patches';
import { ALL_PATCHES } from '../src/patches';
import { checkPatch } from '../src/patch';
import { peak, rms } from '../src/loudness';
import { duration, render } from '../src/synth';
import { seeded } from './helpers';

const NAMES = ['coin', 'hit', 'jump', 'bank', 'drop', 'pickup', 'click', 'whoosh', 'powerup', 'fail', 'explode'];
const entries = Object.entries(ALL_PATCHES);

// The band every stock patch's rms lies in at 48000 with seed 1: set from what was measured, so that no sound is far
// louder than another. Measured from 0.118 (explode) to 0.265 (coin), so the band is a little under a factor of three, about 9.5 dB.
const RMS_BAND = [0.1, 0.3] as const;

describe('the stock patches', () => {
  it('are the eleven named, and ALL_PATCHES holds each export and nothing else', () => {
    expect(Object.keys(ALL_PATCHES).sort()).toEqual([...NAMES].sort());
    const exported = Object.keys(stock).filter((k) => k !== 'ALL_PATCHES');
    expect(exported.sort()).toEqual([...NAMES].sort());
    for (const name of exported) expect(ALL_PATCHES[name as keyof typeof ALL_PATCHES]).toBe(stock[name as never]);
  });

  for (const [name, patch] of entries) {
    describe(name, () => {
      it('passes checkPatch', () => expect(checkPatch(patch)).toBeNull());
      it('lasts under 1.5 s', () => expect(duration(patch)).toBeLessThan(1.5));
      it('peaks at its volume, to within 0.01, at 48000', () => {
        expect(Math.abs(peak(render(patch, 48000, seeded(1))) - patch.volume)).toBeLessThan(0.01);
      });
      it('has an rms inside the band, so it is not far louder than the rest', () => {
        const level = rms(render(patch, 48000, seeded(1)));
        expect(level).toBeGreaterThanOrEqual(RMS_BAND[0]);
        expect(level).toBeLessThanOrEqual(RMS_BAND[1]);
      });
    });
  }
});
