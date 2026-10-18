// The fuzzer: random patches, each field drawn within the range checkPatch allows, rendered at both sample rates, and
// the rules that must hold of any sound checked on each; and random layered sounds, a few layers of any kind, held to
// the same rules. Without it only the stock sounds are ever rendered, and a rule that holds of them could fail on the
// next. A failure names its seed and prints the sound, and the seed alone gives the sound again. Run more of them with
// FUZZ_SEEDS=1-2000 npx vitest run test/fuzz.test.ts.
import { describe, expect, it } from 'vitest';
import { checkLayered, layeredSeconds, renderLayered, type Layer, type Layered } from '../src/layers';
import { FILTERS } from '../src/filter';
import { MAX_SECONDS } from '../src/patch';
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

// A layered sound from a seed: one to four layers of any kind, each field drawn within the range checkLayered allows.
// Everything is kept short (a fall of a fifth of a second at most, a crowd of half a second), so that two thousand of
// them render in seconds; the length rule is held by the checks, not by the draw being timid. Frequencies stay under
// 8 kHz, below either Nyquist, since a tone at the Nyquist is refused by name.
export function randomLayered(seed: number): Layered {
  const r = seeded(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const maybe = <T>(make: () => T): T | undefined => (r() < 0.5 ? make() : undefined);
  const wobble = () => ({ rate: between(0, 40), depth: r() });
  const fall = () => between(0.002, 0.2);
  const plain = (): Exclude<Layer, { kind: 'bounces' }> => {
    const at = r() < 0.5 ? 0 : between(0, 0.3);
    const gain = between(0.05, 2);
    switch (Math.floor(r() * 8)) {
      case 0:
        return {
          kind: 'tone',
          at,
          gain,
          wave: maybe(() => (['sine', 'square', 'saw', 'triangle'] as const)[Math.floor(r() * 4)]),
          f: between(20, 8000),
          fEnd: maybe(() => between(20, 8000)),
          glide: maybe(() => between(0.001, 0.2)),
          attack: maybe(() => between(0, 0.05)),
          sustain: maybe(() => between(0, 0.1)),
          decay: fall(),
          length: maybe(() => between(0.01, 0.3)),
          release: maybe(() => between(0, 0.05)),
          vibrato: maybe(wobble),
          tremolo: maybe(wobble),
        };
      case 1: {
        const steady = r() < 0.2;
        const depth = between(0, 0.3);
        return {
          kind: 'noise',
          at,
          gain,
          filter: maybe(() => FILTERS[Math.floor(r() * FILTERS.length)]),
          f: between(30, 20000),
          fEnd: maybe(() => between(30, 20000)),
          q: maybe(() => between(0.1, 20)),
          attack: maybe(() => between(0, 0.05)),
          sustain: maybe(() => between(0, 0.1)),
          decay: steady ? maybe(fall) : fall(),
          length: steady ? between(0.05, 0.4) : maybe(() => between(0.01, 0.3)),
          release: maybe(() => between(0, 0.05)),
          steady: steady ? true : undefined,
          gusts: maybe(() => [
            { cycles: between(0.1, 8), depth },
            { cycles: between(0.1, 8), depth: between(0, 0.3) },
          ]),
          gustPower: maybe(() => between(0, 4)),
          gustBrighten: maybe(() => between(0, 3)),
        };
      }
      case 2:
        return {
          kind: 'modes',
          at,
          gain,
          modes: Array.from({ length: 1 + Math.floor(r() * 5) }, () => [between(50, 9000), fall(), r()]),
          attack: maybe(() => between(0, 0.02)),
          length: maybe(() => between(0.01, 0.3)),
          release: maybe(() => between(0, 0.05)),
        };
      case 3:
        return {
          kind: 'fm',
          at,
          gain,
          f: between(40, 4000),
          ratio: between(0.1, 12),
          index: between(0, 8),
          indexDecay: fall(),
          indexFloor: maybe(() => between(0, 2)),
          bark: maybe(() => ({ ratio: between(0.5, 16), amount: between(0, 3), decay: between(0.002, 0.05) })),
          attack: maybe(() => between(0, 0.05)),
          sustain: maybe(() => between(0, 0.1)),
          decay: fall(),
          length: maybe(() => between(0.01, 0.3)),
          release: maybe(() => between(0, 0.05)),
          tremolo: maybe(wobble),
        };
      case 4:
        return {
          kind: 'grains',
          at,
          gain,
          count: 1 + Math.floor(r() * 300),
          seconds: between(0.01, 0.4),
          f: between(100, 9000),
          q: maybe(() => between(0.1, 10)),
        };
      case 5: {
        const low = between(100, 3000);
        return {
          kind: 'claps',
          at,
          gain,
          seconds: between(0.05, 0.5),
          rate: between(1, 200),
          ...(r() < 0.5 ? { low, high: low + between(100, 6000) } : {}),
          bands: maybe(() => 1 + Math.floor(r() * 6)),
          q: maybe(() => between(0.3, 8)),
          swell: maybe(() => between(0.01, 0.4)),
          fade: maybe(() => between(0.05, 2)),
          burst: maybe(() => between(0.002, 0.03)),
        };
      }
      case 6:
        return {
          kind: 'bubbles',
          at,
          gain,
          count: 1 + Math.floor(r() * 12),
          spread: between(0.01, 0.4),
          f: between(100, 3000),
          ratio: maybe(() => between(1, 6)),
          rise: maybe(() => between(0.5, 3)),
          glide: maybe(() => between(0.002, 0.05)),
          decay: maybe(() => between(0.005, 0.05)),
        };
      default:
        return {
          kind: 'patch',
          at,
          gain,
          patch: {
            ...randomPatch(Math.floor(r() * 1e6)),
            sustain: 0.05,
            attack: 0.01,
            release: 0.05,
            frequency: between(50, 5000),
            cutoff: between(100, 20000),
          },
        };
    }
  };
  const layers: Layer[] = Array.from({ length: 1 + Math.floor(r() * 4) }, (): Layer => {
    if (r() >= 0.2) return plain();
    return {
      kind: 'bounces',
      at: between(0, 0.2),
      gain: between(0.05, 2),
      layers: Array.from({ length: 1 + Math.floor(r() * 2) }, plain),
      count: 1 + Math.floor(r() * 6),
      gap: between(0.01, 0.2),
      shrink: between(0.3, 1.2),
      fade: r(),
      scatter: maybe(() => between(0, 0.8)),
    };
  });
  return {
    layers,
    volume: between(0.05, 1),
    frequency: maybe(() => between(50, 5000)),
    jitter: maybe(() => between(0, 0.5)),
  };
}

describe('random layered sounds', () => {
  const [from, to] = seedRange();

  for (const sr of [44100, 48000]) {
    it(`render sound at ${sr}, for seeds ${from} to ${to}`, () => {
      for (let seed = from; seed <= to; seed++) {
        const sound = randomLayered(seed);
        const where = `seed ${seed}: ${JSON.stringify(sound)}`;
        expect(checkLayered(sound), where).toBeNull();
        const s = renderLayered(sound, sr, seeded(seed));
        expect(s.length, `${where}: length at ${sr}`).toBe(Math.max(1, Math.round(layeredSeconds(sound) * sr)));
        expect(s.length / sr, `${where}: longer than MAX_SECONDS`).toBeLessThanOrEqual(MAX_SECONDS);
        let bad = -1;
        for (let i = 0; i < s.length && bad < 0; i++) if (!(s[i] >= -1 && s[i] <= 1)) bad = i;
        expect(bad, `${where}: sample ${bad} at ${sr} is NaN or outside [-1, 1]`).toBe(-1);
        expect(s[s.length - 1], `${where}: last sample at ${sr}`).toBe(0);
        // every layer drawn has a gain above 0, so no render is silent; a silent one would be NaN turned to nothing
        expect(Math.abs(peak(s) - sound.volume), `${where}: peak ${peak(s)} at ${sr}`).toBeLessThan(0.01);
      }
    });
  }

  it('gives the same bits twice for a seed, and keeps its shape through JSON', () => {
    for (let seed = from; seed <= Math.min(to, from + 49); seed++) {
      const sound = randomLayered(seed);
      const a = renderLayered(sound, 48000, seeded(seed));
      const b = renderLayered(JSON.parse(JSON.stringify(sound)) as Layered, 48000, seeded(seed));
      expect(Array.from(b), `seed ${seed}`).toEqual(Array.from(a));
    }
  });
});
