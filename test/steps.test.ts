// A song's steps, swing, offsets and fixed voices, and a layered sound as a voice's patch, under node: where the notes
// fall is a sum, so the sums are checked here against the sums written out by hand. Every default is also held to
// leave a song as it was, since a song written for v0.2.0 must sound the same in v0.3.0.
import { describe, expect, it } from 'vitest';
import type { Layered } from '../src/layers';
import { DEFAULT_PATCH } from '../src/patch';
import { checkSong, notes, type Song, type Voice } from '../src/song';
import { calm } from '../src/songs';
import { seeded } from './helpers';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const voice = (changes: Partial<Voice> = {}): Voice => ({
  patch: DEFAULT_PATCH,
  pattern: [0],
  octave: 0,
  gain: 1,
  ...changes,
});
const song = (changes: Partial<Song> = {}): Song => ({
  bpm: 120,
  root: 60,
  scale: MAJOR,
  chords: [[0, 2, 4]],
  voices: [voice()],
  ...changes,
});
const LAYERED: Layered = {
  volume: 0.5,
  frequency: 440,
  layers: [{ kind: 'tone', at: 0, gain: 1, f: 440, decay: 0.1 }],
};
const beats = (s: Song, from: number, to: number): number[] => notes(s, from, to).map((n) => n.beat);
const midiOf = (frequency: number): number => Math.round(69 + 12 * Math.log2(frequency / 440));

describe('steps', () => {
  it('has a note on each step of a beat, so two a beat at 2 steps, and the pattern goes a step at a time', () => {
    const s = song({ steps: 2, voices: [voice({ pattern: [0, 1] })] });
    expect(beats(s, 0, 2)).toEqual([0, 0.5, 1, 1.5]);
    // step 0 is the chord's first degree (C), step 1 its second (E)
    expect(notes(s, 0, 2).map((n) => midiOf(n.frequency))).toEqual([60, 64, 60, 64]);
  });

  it('keeps a bar four beats long, so the chord changes at beat 4 and not at step 4', () => {
    const s = song({
      steps: 2,
      chords: [
        [0, 2, 4],
        [4, 6, 1],
      ],
    });
    const got = notes(s, 0, 8);
    expect(got).toHaveLength(16);
    expect(got.filter((n) => n.beat < 4).every((n) => midiOf(n.frequency) === 60)).toBe(true);
    expect(got.filter((n) => n.beat >= 4).every((n) => midiOf(n.frequency) === 67)).toBe(true);
  });

  it('is a note a beat at 1, as a song with no steps field is', () => {
    expect(notes(song({ steps: 1 }), 0, 16)).toEqual(notes(song(), 0, 16));
  });

  it('wraps a pattern in steps, so a pattern of 8 at 2 steps is a four-beat bar', () => {
    const s = song({ steps: 2, voices: [voice({ pattern: [0, null, null, null, 2, null, null, null] })] });
    expect(beats(s, 0, 8)).toEqual([0, 2, 4, 6]);
    expect(notes(s, 0, 8).map((n) => midiOf(n.frequency))).toEqual([60, 67, 60, 67]);
  });

  it('works at 3 and 4 steps, a note on each', () => {
    expect(beats(song({ steps: 4 }), 0, 1)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(beats(song({ steps: 3 }), 0, 1).map((b) => Number(b.toFixed(6)))).toEqual([0, 0.333333, 0.666667]);
  });

  it('is half open: a note on `from` is in, a note on `to` is out', () => {
    const s = song({ steps: 2 });
    expect(beats(s, 0.5, 1.5)).toEqual([0.5, 1]);
  });
});

describe('swing', () => {
  it('delays each odd step by a share of the step, and leaves the even steps where they are', () => {
    const s = song({ steps: 2, voices: [voice({ swing: 0.2 })] });
    const got = beats(s, 0, 2);
    expect(got.map((b) => Number(b.toFixed(9)))).toEqual([0, 0.6, 1, 1.6]);
  });

  it('is nothing at 0, which is also its default', () => {
    expect(notes(song({ steps: 2, voices: [voice({ swing: 0 })] }), 0, 8)).toEqual(notes(song({ steps: 2 }), 0, 8));
  });

  it('is only on the voice that has it', () => {
    const s = song({ steps: 2, voices: [voice(), voice({ swing: 0.25 })] });
    expect(notes(s, 0, 1).map((n) => [n.voice, n.beat])).toEqual([
      [0, 0],
      [1, 0],
      [0, 0.5],
      [1, 0.625],
    ]);
  });

  it('at 1 step swings the odd beats', () => {
    expect(beats(song({ voices: [voice({ swing: 0.5 })] }), 0, 4)).toEqual([0, 1.5, 2, 3.5]);
  });

  it('keeps a note in the bar of its step: a swung last step does not take the next chord', () => {
    const s = song({
      steps: 2,
      chords: [
        [0, 2, 4],
        [4, 6, 1],
      ],
      voices: [voice({ swing: 0.5 })],
    });
    // step 7 is beat 3.5, swung to 3.75, and is still in bar 0, so still C
    const last = notes(s, 3.6, 3.9);
    expect(last).toHaveLength(1);
    expect(midiOf(last[0].frequency)).toBe(60);
  });
});

describe('offset', () => {
  it('moves each note of the voice later by that many beats', () => {
    const s = song({ voices: [voice({ offset: 0.25 })] });
    expect(beats(s, 0, 3)).toEqual([0.25, 1.25, 2.25]);
  });

  it('puts the note in the range by where it falls and not where its step is', () => {
    const s = song({ voices: [voice({ offset: 0.25 })] });
    // the step on beat 1 falls at 1.25: not in [0.5, 1.2), in [1.2, 1.3)
    expect(beats(s, 0.5, 1.2)).toEqual([]);
    expect(beats(s, 1.2, 1.3)).toEqual([1.25]);
  });

  it('may be before the step, for a note a touch early', () => {
    const s = song({ voices: [voice({ offset: -0.25 })] });
    expect(beats(s, -1, 2)).toEqual([-0.25, 0.75, 1.75]);
  });

  it('reaches the steps far from the range, when the offset is a beat early or late', () => {
    const early = song({ steps: 4, voices: [voice({ offset: -1 })] });
    expect(beats(early, 0, 1)).toEqual([0, 0.25, 0.5, 0.75]);
    const late = song({ steps: 4, voices: [voice({ offset: 1 })] });
    expect(beats(late, 1, 2)).toEqual([1, 1.25, 1.5, 1.75]);
  });

  it('gives a strum: several voices, each a little later, together one chord', () => {
    const s = song({
      voices: [0, 1, 2].map((degree) => voice({ pattern: [degree], offset: degree * 0.0164 })),
    });
    const got = notes(s, 0, 1);
    expect(got.map((n) => midiOf(n.frequency))).toEqual([60, 64, 67]);
    expect(got.map((n) => Number(n.beat.toFixed(4)))).toEqual([0, 0.0164, 0.0328]);
  });
});

describe('notes in order and in ranges', () => {
  it('come in the order of the beat they fall at, then the voice', () => {
    const s = song({
      steps: 2,
      voices: [voice({ offset: 0.3 }), voice({ swing: 0.5 }), voice()],
    });
    const got = notes(s, 0, 4);
    for (let i = 1; i < got.length; i++) {
      const a = got[i - 1];
      const b = got[i];
      expect(a.beat < b.beat || (a.beat === b.beat && a.voice < b.voice), `${i}`).toBe(true);
    }
  });

  it('give each note once however the beats are cut: ranges end to end are the whole range', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = seeded(seed);
      const s = song({
        bpm: 90,
        steps: 1 + Math.floor(r() * 4),
        chords: [
          [0, 2, 4],
          [4, 6, 1],
          [5, 0],
        ],
        voices: [0, 1, 2].map(() =>
          voice({
            pattern: Array.from({ length: 1 + Math.floor(r() * 9) }, () => (r() < 0.3 ? null : Math.floor(r() * 7))),
            swing: r() < 0.5 ? 0 : r() * 0.5,
            offset: r() < 0.5 ? 0 : (r() - 0.3) * 0.6,
            octave: Math.floor(r() * 3),
          }),
        ),
      });
      expect(checkSong(s), `seed ${seed}`).toBeNull();
      const whole = notes(s, -3, 20);
      const cuts = [-3, ...Array.from({ length: 6 }, () => -3 + r() * 23).sort((a, b) => a - b), 20];
      const parts = cuts.slice(1).flatMap((to, i) => notes(s, cuts[i], to));
      expect(parts, `seed ${seed}`).toEqual(whole);
    }
  });
});

describe('the defaults leave a song as it was', () => {
  it('calm is the same with every new field written out at its default', () => {
    const explicit: Song = {
      ...calm,
      steps: 1,
      voices: calm.voices.map((v) => ({ ...v, swing: 0, fixed: false, offset: 0 })),
    };
    expect(notes(explicit, 0, 64)).toEqual(notes(calm, 0, 64));
    expect(notes(explicit, -7.5, 33.25)).toEqual(notes(calm, -7.5, 33.25));
  });

  it('calm has a note on whole beats only', () => {
    for (const n of notes(calm, 0, 64)) expect(Number.isInteger(n.beat)).toBe(true);
  });
});

describe('checkSong for the new fields', () => {
  const bad = (changes: Record<string, unknown>): string | null => checkSong({ ...song(), ...changes });
  const badVoice = (changes: Record<string, unknown>): string | null =>
    checkSong(song({ voices: [voice(), { ...voice(), ...changes }] }));

  it('refuses steps of 0, below 0, not whole, not a number or too many, by name', () => {
    for (const v of [0, -1, 1.5, NaN, Infinity, '2', 65]) expect(bad({ steps: v }), String(v)).toMatch(/^steps/);
    expect(bad({ steps: 1 })).toBeNull();
    expect(bad({ steps: 16 })).toBeNull();
  });

  it('refuses a swing outside 0..0.75, naming the voice', () => {
    for (const v of [-0.1, 0.8, NaN, Infinity, '0.2'])
      expect(badVoice({ swing: v }), String(v)).toMatch(/^voices\[1\]\.swing/);
    expect(badVoice({ swing: 0.75 })).toBeNull();
  });

  it('refuses an offset outside -1..1, naming the voice', () => {
    for (const v of [-1.1, 1.1, NaN, Infinity, '0'])
      expect(badVoice({ offset: v }), String(v)).toMatch(/^voices\[1\]\.offset/);
    expect(badVoice({ offset: -1 })).toBeNull();
  });

  it('refuses a fixed that is not true or false', () => {
    for (const v of [1, 'yes', null]) expect(badVoice({ fixed: v }), String(v)).toMatch(/^voices\[1\]\.fixed/);
    expect(badVoice({ fixed: true })).toBeNull();
  });

  it('accepts a layered sound as a voice patch, when it has a frequency to be bent from', () => {
    expect(badVoice({ patch: LAYERED })).toBeNull();
  });

  it('refuses a layered voice with no frequency, naming it, unless the voice is fixed', () => {
    const { frequency: _frequency, ...unpitched } = LAYERED;
    expect(badVoice({ patch: unpitched })).toMatch(/^voices\[1\]\.patch\.frequency/);
    expect(badVoice({ patch: unpitched, fixed: true })).toBeNull();
  });

  it('refuses a bad layered voice by the path of its field', () => {
    const q = { ...LAYERED, layers: [{ kind: 'noise', at: 0, gain: 1, f: 800, q: 0, decay: 0.1 }] };
    expect(badVoice({ patch: q })).toMatch(/^voices\[1\]\.patch: layers\[0\]\.q/);
  });
});
