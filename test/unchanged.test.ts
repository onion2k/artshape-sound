/**
 * The stock sounds and the stock song as v0.1.0 left them, held bit for bit.
 *
 * Every game that pins this package is to sound exactly as it did until it opts in to something new, and a test of
 * what a sound is like only holds it to within a tolerance: a pitch that moved by a part in ten million, or a filter
 * that settled a sample later, would pass every other test here and still change a game. So each stock patch is
 * rendered at 48000 Hz from a fixed seed (SEED, below) and its samples are hashed. The hashes were written by the
 * source at the commit that added this file, before anything else changed. Each field of the synth a later change is to
 * touch was checked by changing a patch by a part in ten million and seeing its hash fail.
 *
 * The stock songs are held the same way, by their notes and not their samples: the first SONG_BEATS beats of each are
 * written out as one line a note (beat, voice, frequency to six decimals, gain) and the text is hashed. A chord
 * degree, a pattern step, the key, the scale or a voice's gain that moved would change a game's music without moving
 * any sound above. The patches a song's voices carry are not held here: their numbers are not in a note.
 *
 * The layered sounds that came with v0.3.0 are held the same way, under `layered`: each stock layered sound rendered
 * at 48000 from the same seed (the wind as a loop of WIND_SECONDS), and each distinct sound a voice of the song
 * `lounge` carries, which a song's notes do not hold. Nothing above them was touched when they were added: the
 * patches and the song `calm` keep the hashes they had.
 *
 * A hash that moves is a change in sound, whatever the change meant to do. It is written again only for a change
 * meant to move it, or for a Node upgrade that changes the bits `Math` gives, which is confirmed by checking the old
 * commit out on the new Node first; the commit says which.
 *
 *   UNCHANGED_UPDATE=1 npx vitest run test/unchanged.test.ts    write the hashes again
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderLayered, renderLoop, type Layered } from '../src/layers';
import { ALL_PATCHES } from '../src/patches';
import { notes } from '../src/song';
import { calm, lounge } from '../src/songs';
import { ALL_LAYERED, WIND_SECONDS } from '../src/sounds';
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
/** What a song was: the hash of its notes' text, and how many there were. */
interface SongLook {
  hash: string;
  notes: number;
}
type Hashes = {
  seed: number;
  sampleRate: number;
  patches: { [name: string]: Look };
  songBeats: number;
  songs: { [name: string]: SongLook };
  layered: { [name: string]: Look };
};

/** How many beats of each stock song are held: sixteen bars, which takes the chords round four times. */
const SONG_BEATS = 64;
const STOCK_SONGS = { calm, lounge };

/** The layered sounds held: the stock ones, and each distinct sound a voice of `lounge` carries, by the first voice. */
const LOOPS: { [name: string]: number } = { wind: WIND_SECONDS };
function layeredSounds(): { [name: string]: Layered } {
  const out: { [name: string]: Layered } = { ...ALL_LAYERED };
  const seen = new Set<unknown>();
  lounge.voices.forEach((voice, i) => {
    if (seen.has(voice.patch)) return;
    seen.add(voice.patch);
    out[`lounge voice ${i}`] = voice.patch as Layered;
  });
  return out;
}
const LAYERED = layeredSounds();

/** FNV-1a over the bytes of the samples, 32 bits of it: enough to tell one sound from another, and cheap. */
function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < bytes.length; k++) {
    h ^= bytes[k];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function look(name: string): Look {
  const samples = render(ALL_PATCHES[name as keyof typeof ALL_PATCHES], SAMPLE_RATE, seeded(SEED));
  return { hash: fnv(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)), length: samples.length };
}

function layeredLook(name: string): Look {
  const sound = LAYERED[name];
  const samples =
    name in LOOPS
      ? renderLoop(sound, LOOPS[name], SAMPLE_RATE, seeded(SEED))
      : renderLayered(sound, SAMPLE_RATE, seeded(SEED));
  return { hash: fnv(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)), length: samples.length };
}

function songLook(name: string): SongLook {
  const got = notes(STOCK_SONGS[name as keyof typeof STOCK_SONGS], 0, SONG_BEATS);
  const text = got.map((n) => `${n.beat} ${n.voice} ${n.frequency.toFixed(6)} ${n.gain}`).join('\n');
  return { hash: fnv(new TextEncoder().encode(text)), notes: got.length };
}

const recorded: Hashes | null = UPDATE ? null : (JSON.parse(readFileSync(RECORD, 'utf8')) as Hashes);
const written: Hashes = {
  seed: SEED,
  sampleRate: SAMPLE_RATE,
  patches: {},
  songBeats: SONG_BEATS,
  songs: {},
  layered: {},
};

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

  it('are held to the number of beats they were written at', () => {
    if (recorded) expect(recorded.songBeats).toBe(SONG_BEATS);
  });

  for (const name of Object.keys(STOCK_SONGS)) {
    it(`the song ${name}`, () => {
      const now = songLook(name);
      expect(songLook(name), 'the notes are not the same twice').toEqual(now);
      expect(now.notes, 'the song has no notes to hold').toBeGreaterThan(0);
      if (UPDATE) {
        written.songs[name] = now;
        return;
      }
      const then = recorded!.songs[name] as SongLook | undefined;
      expect(then, `no hash recorded for the song "${name}"`).toBeDefined();
      expect(now, `${name} was ${then!.notes} notes, is ${now.notes}: the music has changed`).toEqual(then);
    });
  }

  it('has a hash for no song that is gone', () => {
    if (recorded) expect(Object.keys(recorded.songs).sort()).toEqual(Object.keys(STOCK_SONGS).sort());
  });

  for (const name of Object.keys(LAYERED)) {
    it(`the layered sound ${name}`, () => {
      const now = layeredLook(name);
      expect(layeredLook(name), 'the sound is not the same twice from one seed').toEqual(now);
      if (UPDATE) {
        written.layered[name] = now;
        return;
      }
      const then = recorded!.layered[name] as Look | undefined;
      expect(then, `no hash recorded for "${name}"`).toBeDefined();
      expect(now, `${name} was ${then!.length} samples, is ${now.length}: the sound has changed`).toEqual(then);
    });
  }

  it('has a hash for no layered sound that is gone', () => {
    if (recorded) expect(Object.keys(recorded.layered).sort()).toEqual(Object.keys(LAYERED).sort());
  });

  if (UPDATE)
    it('writes the hashes', () => {
      writeFileSync(RECORD, JSON.stringify(written, null, 2) + '\n');
    });
});
