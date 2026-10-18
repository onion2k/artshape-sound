// The fuzzer: random patches, each field drawn within the range checkPatch allows, rendered at both sample rates, and
// the rules that must hold of any sound checked on each. Without it only the eleven stock patches are ever rendered,
// and a rule that holds of them could fail on the twelfth. A failure names its seed and prints the patch, and the seed
// alone gives the patch again. Run more of them with FUZZ_SEEDS=1-2000 npx vitest run test/fuzz.test.ts.
import { describe, expect, it } from 'vitest';
import { checkPatch, WAVES, type Patch } from '../src/patch';
import { peak } from '../src/loudness';
import { duration, render } from '../src/synth';
import { seeded } from './helpers';

// "1-2000" is seeds 1 to 2000; the default is the first 200, which takes well under a second.
function seedRange(): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec(process.env.FUZZ_SEEDS ?? '1-200');
  if (m === null) throw new Error(`FUZZ_SEEDS must look like 1-2000, got ${process.env.FUZZ_SEEDS}`);
  return [Number(m[1]), Number(m[2])];
}

// A patch from a seed. Frequencies stay under 8 kHz, well below either Nyquist, since render refuses those by name;
// a stage is 0 or at least a millisecond, so that the sound is never rounded away to no samples.
export function randomPatch(seed: number): Patch {
  const r = seeded(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const stage = (hi: number) => (r() < 0.25 ? 0 : between(0.001, hi));
  let attack = stage(0.4);
  let sustain = stage(0.6);
  const release = stage(0.6);
  if (attack + sustain + release === 0) sustain = 0.1;
  if (attack === 0 && r() < 0.5) attack = 0.001;
  return {
    wave: WAVES[Math.floor(r() * WAVES.length)],
    frequency: between(20, 8000),
    slide: between(-6000, 6000),
    attack,
    sustain,
    release,
    punch: r(),
    volume: r(),
    cutoff: r() < 0.4 ? Infinity : between(30, 20000),
    cutoffSlide: between(-20000, 20000),
    vibratoDepth: r() < 0.5 ? 0 : between(0, 2000),
    vibratoRate: between(0, 50),
    noise: r() < 0.5 ? 0 : r(),
    repeat: r() < 0.5 ? 0 : between(1, 60),
    jitter: r() < 0.5 ? 0 : r(),
  };
}

describe('random patches', () => {
  const [from, to] = seedRange();

  it(`render sound at 44100 and 48000, for seeds ${from} to ${to}`, () => {
    for (let seed = from; seed <= to; seed++) {
      const patch = randomPatch(seed);
      const where = `seed ${seed}: ${JSON.stringify(patch)}`;
      expect(checkPatch(patch), where).toBeNull();
      for (const sr of [44100, 48000]) {
        const s = render(patch, sr, seeded(seed));
        expect(s.length, `${where}: length at ${sr}`).toBe(Math.round(duration(patch) * sr));
        let bad = -1;
        for (let i = 0; i < s.length && bad < 0; i++) if (!(s[i] >= -1 && s[i] <= 1)) bad = i;
        expect(bad, `${where}: sample ${bad} at ${sr} is NaN or outside [-1, 1]`).toBe(-1);
        expect(s[s.length - 1], `${where}: last sample at ${sr}`).toBe(0);
        const top = peak(s);
        // Silence is allowed only where the patch asks for it, with a volume of 0, which the draw reaches only if r() is
        // exactly 0. Normalising turns NaN into silence, since a NaN has no peak, so a silent render is a fault.
        if (patch.volume === 0) expect(top, `${where}: not silent at volume 0`).toBe(0);
        else expect(Math.abs(top - patch.volume), `${where}: peak ${top} at ${sr}`).toBeLessThan(0.01);
      }
    }
  });
});
