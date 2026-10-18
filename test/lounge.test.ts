// The stock song `lounge` under node: the notes it plays, read back from the sums and compared with the music it was
// written from (Fmaj9, Em7, Dm9 and Cmaj9, a piano chord strummed on the first beat and softer after the second, a
// bass, a kick, a snare and swung hats), and that every one of its voices is a sound that passes its check.
import { describe, expect, it } from 'vitest';
import { checkLayered, isLayered, renderLayered } from '../src/layers';
import { notes, checkSong, type Note } from '../src/song';
import { lounge } from '../src/songs';
import { seeded } from './helpers';

const midiOf = (frequency: number): number => Math.round(69 + 12 * Math.log2(frequency / 440));
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;
const of = (got: Note[], from: number, to: number): Note[] => got.filter((n) => n.voice >= from && n.voice < to);
// the voices, by what they are: five strings struck on the beat, five on the half beat, three basses, a kick, a snare, two hats
const STRINGS_A = [0, 5];
const STRINGS_B = [5, 10];
const BASSES = [10, 13];
const KICK = 13;
const SNARE = 14;
const HAT_DOWN = 15;
const HAT_UP = 16;
const VOICINGS = [
  [53, 57, 60, 64, 67],
  [52, 55, 59, 62],
  [50, 53, 57, 60, 64],
  [48, 52, 55, 59, 62],
];
const ROOTS = [41, 40, 38, 36];
const STRUM = 0.0164;

describe('the song lounge', () => {
  const got = notes(lounge, 0, 16);

  it('passes checkSong, at 82 beats a minute, two steps to a beat, in C major', () => {
    expect(checkSong(lounge)).toBeNull();
    expect(lounge.bpm).toBe(82);
    expect(lounge.steps).toBe(2);
    expect(lounge.chords).toHaveLength(4);
  });

  it('has seventeen voices over seven sounds, the five strings of each piano hit sharing one', () => {
    expect(lounge.voices).toHaveLength(17);
    expect(new Set(lounge.voices.map((v) => v.patch)).size).toBe(7);
    for (const v of lounge.voices) expect(isLayered(v.patch)).toBe(true);
  });

  it('has every voice sound, and every sound pass its check, and render', () => {
    for (let v = 0; v < lounge.voices.length; v++) {
      expect(of(got, v, v + 1).length, `voice ${v} is silent`).toBeGreaterThan(0);
    }
    for (const patch of new Set(lounge.voices.map((v) => v.patch))) {
      expect(checkLayered(patch)).toBeNull();
      const out = renderLayered(patch as never, 48000, seeded(1));
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('voices the piano as Fmaj9, Em7, Dm9 and Cmaj9, strummed from the lowest string, on the first beat of the bar', () => {
    for (let bar = 0; bar < 4; bar++) {
      const hit = of(got, ...(STRINGS_A as [number, number])).filter((n) => n.beat >= bar * 4 && n.beat < bar * 4 + 1);
      expect(
        hit.map((n) => midiOf(n.frequency)),
        `bar ${bar}`,
      ).toEqual(VOICINGS[bar]);
      hit.forEach((n, string) =>
        expect(near(n.beat, bar * 4 + string * STRUM), `bar ${bar} string ${string}`).toBe(true),
      );
    }
  });

  it('plays the same chord again, softer, on the half beat after the second beat', () => {
    for (let bar = 0; bar < 4; bar++) {
      const hit = of(got, ...(STRINGS_B as [number, number])).filter(
        (n) => n.beat >= bar * 4 + 2 && n.beat < bar * 4 + 3,
      );
      expect(
        hit.map((n) => midiOf(n.frequency)),
        `bar ${bar}`,
      ).toEqual(VOICINGS[bar]);
      hit.forEach((n, string) =>
        expect(near(n.beat, bar * 4 + 2.5 + string * STRUM), `bar ${bar} string ${string}`).toBe(true),
      );
      expect(hit[0].gain).toBeLessThan(of(got, 0, 1)[0].gain);
    }
  });

  it('puts a bass under it: the root on the beat and the half beat, and a fifth above on the last half beat', () => {
    for (let bar = 0; bar < 4; bar++) {
      const [long, mid, short] = [10, 11, 12].map((v) =>
        got.filter((n) => n.voice === v && n.beat >= bar * 4 && n.beat < bar * 4 + 4),
      );
      expect(long.map((n) => [n.beat, midiOf(n.frequency)])).toEqual([[bar * 4, ROOTS[bar]]]);
      expect(mid.map((n) => [n.beat, midiOf(n.frequency)])).toEqual([[bar * 4 + 2.5, ROOTS[bar]]]);
      expect(short.map((n) => [n.beat, midiOf(n.frequency)])).toEqual([[bar * 4 + 3.5, ROOTS[bar] + 7]]);
    }
    expect(BASSES).toEqual([10, 13]);
  });

  it('keeps a kick, a snare and hats on their beats, the hats swung', () => {
    const at = (voice: number): number[] => got.filter((n) => n.voice === voice && n.beat < 4).map((n) => n.beat);
    expect(at(KICK)).toEqual([0, 2.5]);
    expect(at(SNARE)).toEqual([1, 3]);
    expect(at(HAT_DOWN)).toEqual([0, 1, 2, 3]);
    // the off hats are a fifth of a step, a tenth of a beat, late
    expect(at(HAT_UP).map((b) => Number(b.toFixed(9)))).toEqual([0.6, 1.6, 2.6, 3.6]);
  });

  it('marks its drums fixed, so they keep their pitch', () => {
    for (const v of [KICK, SNARE, HAT_DOWN, HAT_UP]) expect(lounge.voices[v].fixed).toBe(true);
    for (const v of [0, 5, 10, 11, 12]) expect(lounge.voices[v].fixed).toBeUndefined();
  });

  it('keeps every pitched note in C major', () => {
    const classes = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (const n of got.filter((n) => n.voice < 13))
      expect(classes.has(midiOf(n.frequency) % 12), `${n.voice} at ${n.beat}`).toBe(true);
  });

  it('goes round every sixteen beats: the same notes a cycle later', () => {
    const next = notes(lounge, 16, 32);
    expect(next).toHaveLength(got.length);
    next.forEach((n, i) => {
      expect(near(n.beat - 16, got[i].beat)).toBe(true);
      expect([n.voice, n.frequency, n.gain]).toEqual([got[i].voice, got[i].frequency, got[i].gain]);
    });
  });

  it('is cut anywhere without losing or doubling a note', () => {
    expect([...notes(lounge, 0, 5.3), ...notes(lounge, 5.3, 9.77), ...notes(lounge, 9.77, 16)]).toEqual(got);
  });

  it('survives JSON as the same song', () => {
    expect(JSON.parse(JSON.stringify(lounge))).toEqual(lounge);
    expect(checkSong(JSON.parse(JSON.stringify(lounge)))).toBeNull();
  });
});
