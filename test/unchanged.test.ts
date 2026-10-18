/**
 * The stock sounds as v0.1.0 left them, held bit for bit.
 *
 * Every game that pins this package is to sound exactly as it did until it opts in to something new, and a test of
 * what a sound is like only holds it to within a tolerance: a pitch that moved by a part in ten million, or a filter
 * that settled a sample later, would pass every other test here and still change a game. So each stock patch is
 * rendered at 48000 Hz from a fixed seed (SEED, below) and its samples are hashed. The hashes were written by the
 * source at the commit that added this file, before anything else changed. Each field of the synth a later change is to
 * touch was checked by changing a patch by a part in ten million and seeing its hash fail.
 *
 * A hash that moves is a change in sound, whatever the change meant to do. It is written again only for a change
 * meant to move it, or for a Node upgrade that changes the bits `Math` gives, which is confirmed by checking the old
 * commit out on the new Node first; the commit says which.
 *
 *   UNCHANGED_UPDATE=1 npx vitest run test/unchanged.test.ts    write the hashes again
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_PATCHES } from '../src/patches';
import { render } from '../src/synth';
import { seeded } from './helpers';

const RECORD = new URL('./unchanged.json', import.meta.url);
const UPDATE = process.env.UNCHANGED_UPDATE === '1';
/** The seed every patch is rendered from, so that jitter and noise are the same on every run. */
const SEED = 20261018;
const SAMPLE_RATE = 48000;

/** What a sound was: the hash, and enough besides to say how it differs. */
interface Look {
  hash: string;
  length: number;
}
type Hashes = { seed: number; sampleRate: number; patches: { [name: string]: Look } };

/** FNV-1a over the bytes of the samples, 32 bits of it: enough to tell one sound from another, and cheap. */
function fnv(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let h = 0x811c9dc5;
  for (let k = 0; k < bytes.length; k++) {
    h ^= bytes[k];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function look(name: string): Look {
  const samples = render(ALL_PATCHES[name as keyof typeof ALL_PATCHES], SAMPLE_RATE, seeded(SEED));
  return { hash: fnv(samples), length: samples.length };
}

const recorded: Hashes | null = UPDATE ? null : (JSON.parse(readFileSync(RECORD, 'utf8')) as Hashes);
const written: Hashes = { seed: SEED, sampleRate: SAMPLE_RATE, patches: {} };

describe('the stock patches, unchanged since v0.1.0', () => {
  it('are held to the seed and rate they were written at', () => {
    if (recorded)
      expect({ seed: recorded.seed, sampleRate: recorded.sampleRate }).toEqual({ seed: SEED, sampleRate: SAMPLE_RATE });
  });

  for (const name of Object.keys(ALL_PATCHES)) {
    it(name, () => {
      const now = look(name);
      // the same sound twice in one run: a hash that moves between them is chance from outside the seed
      expect(look(name), 'the sound is not the same twice from one seed').toEqual(now);
      if (UPDATE) {
        written.patches[name] = now;
        return;
      }
      const then = recorded!.patches[name] as Look | undefined;
      expect(then, `no hash recorded for "${name}"`).toBeDefined();
      expect(now, `${name} was ${then!.length} samples, is ${now.length}: the sound has changed`).toEqual(then);
    });
  }

  it('has a hash for no patch that is gone', () => {
    if (recorded) expect(Object.keys(recorded.patches).sort()).toEqual(Object.keys(ALL_PATCHES).sort());
  });

  if (UPDATE)
    it('writes the hashes', () => {
      writeFileSync(RECORD, JSON.stringify(written, null, 2) + '\n');
    });
});
