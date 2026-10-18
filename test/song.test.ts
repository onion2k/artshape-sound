import { describe, expect, it } from 'vitest';
import { DEFAULT_PATCH, type Patch } from '../src/patch';
import { checkSong, notes, type Song, type Voice } from '../src/song';
import { calm } from '../src/songs';
import { duration } from '../src/synth';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const voice = (changes: Partial<Voice> = {}): Voice => ({
  patch: DEFAULT_PATCH,
  pattern: [0],
  octave: 0,
  gain: 1,
  ...changes,
});
// C4 (MIDI 60) major, one voice that plays the chord's root on every beat, over two bars of different chords.
const song = (changes: Partial<Song> = {}): Song => ({
  bpm: 120,
  root: 60,
  scale: MAJOR,
  chords: [[0, 2, 4]],
  voices: [voice()],
  ...changes,
});

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
/** The MIDI note a frequency is, read back; not whole when the frequency is not a note. */
const midiOf = (frequency: number): number => 69 + 12 * Math.log2(frequency / 440);

describe('notes', () => {
  it('gives the notes in [from, to): one on from is in, one on to is out', () => {
    expect(notes(song(), 2, 5).map((n) => n.beat)).toEqual([2, 3, 4]);
    expect(notes(song(), 0, 1).map((n) => n.beat)).toEqual([0]);
  });

  it('puts a note that falls between whole beats on the next whole beat, and none before from', () => {
    expect(notes(song(), 0.5, 2.5).map((n) => n.beat)).toEqual([1, 2]);
    expect(notes(song(), 0.2, 0.9)).toEqual([]);
  });

  it('gives nothing for an empty or backwards range', () => {
    expect(notes(song(), 3, 3)).toEqual([]);
    expect(notes(song(), 5, 2)).toEqual([]);
  });

  it('refuses a range that is not finite, by name', () => {
    expect(() => notes(song(), 0, NaN)).toThrow(/toBeat/);
    expect(() => notes(song(), NaN, 4)).toThrow(/fromBeat/);
  });

  it('is the same over a range as over its halves put together', () => {
    const s = song({ voices: [voice({ pattern: [0, 1, null, 2] }), voice({ pattern: [2, 0] })] });
    expect(notes(s, 0, 20).length).toBeGreaterThan(20);
    expect([...notes(s, 0, 7), ...notes(s, 7, 20)]).toEqual(notes(s, 0, 20));
  });

  it('orders by beat, then by voice', () => {
    const s = song({ voices: [voice(), voice(), voice()] });
    const got = notes(s, 0, 3).map((n) => [n.beat, n.voice]);
    expect(got).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
  });

  it('gives a voice with nothing in it no notes, and a song with no voices none at all', () => {
    expect(notes(song({ voices: [] }), 0, 16)).toEqual([]);
  });

  it('gives a rest nothing, and leaves the other voices alone', () => {
    const s = song({ voices: [voice({ pattern: [0, null, 0, null] }), voice({ pattern: [null] })] });
    const got = notes(s, 0, 8);
    expect(got.map((n) => n.beat)).toEqual([0, 2, 4, 6]);
    expect(got.every((n) => n.voice === 0)).toBe(true);
  });

  it('wraps a pattern, so a pattern shorter than the range plays again from its start', () => {
    const s = song({ voices: [voice({ pattern: [0, 1, 2] })] });
    const midis = notes(s, 0, 7).map((n) => Math.round(midiOf(n.frequency)));
    // the chord is I: degrees 0, 2, 4 of C major are C, E, G
    expect(midis).toEqual([60, 64, 67, 60, 64, 67, 60]);
  });

  it('respects the degrees of the chord that the beat is in, a bar of four beats to a chord', () => {
    // I is C E G; V is degrees 4, 6, 1: G B D.
    const s = song({
      chords: [
        [0, 2, 4],
        [4, 6, 1],
      ],
      voices: [voice({ pattern: [0, 1, 2, 0] })],
    });
    const midis = notes(s, 0, 8).map((n) => Math.round(midiOf(n.frequency)));
    expect(midis.slice(0, 4)).toEqual([60, 64, 67, 60]);
    expect(midis.slice(4, 8)).toEqual([67, 71, 62, 67]);
  });

  it('goes round the chords: bar 2 of two chords is the first again, and a negative beat is before it', () => {
    const s = song({ chords: [[0], [4]], voices: [voice()] });
    const at = (beat: number): number => Math.round(midiOf(notes(s, beat, beat + 1)[0].frequency));
    expect([at(0), at(3), at(4), at(7), at(8), at(11)]).toEqual([60, 60, 67, 67, 60, 60]);
    expect(at(-1)).toBe(67);
    expect(at(-4)).toBe(67);
    expect(at(-5)).toBe(60);
  });

  it('carries a degree past the chord’s length into the next octave', () => {
    const s = song({ voices: [voice({ pattern: [3, 4, 5, 6] })] });
    const midis = notes(s, 0, 4).map((n) => Math.round(midiOf(n.frequency)));
    // chord C E G: entry 3 is the root an octave up, 4 the next degree an octave up, 6 two octaves up
    expect(midis).toEqual([72, 76, 79, 84]);
  });

  it('adds the voice’s octave to the carry, in either direction', () => {
    const s = song({ voices: [voice({ pattern: [0, 3], octave: -2 }), voice({ pattern: [0], octave: 1 })] });
    const got = notes(s, 0, 2).map((n) => Math.round(midiOf(n.frequency)));
    expect(got).toEqual([36, 72, 48, 72]);
  });

  it('uses the scale’s steps for the semitones, so a minor scale gives a minor third', () => {
    const s = song({ scale: [0, 2, 3, 5, 7, 8, 10], voices: [voice({ pattern: [1] })] });
    expect(Math.round(midiOf(notes(s, 0, 1)[0].frequency))).toBe(63);
  });

  it('gives the frequency of the MIDI note, 440 Hz for A4, and the voice’s gain', () => {
    const s = song({ root: 69, voices: [voice({ gain: 0.25 })] });
    const [n] = notes(s, 0, 1);
    expect(n.frequency).toBeCloseTo(440, 9);
    expect(n.gain).toBe(0.25);
    expect(n.voice).toBe(0);
    expect(notes(song({ root: 60 }), 0, 1)[0].frequency).toBeCloseTo(hz(60), 9);
  });

  it('keeps every note in the key: its pitch class is the root plus a step of the scale', () => {
    const s = song({
      root: 62,
      scale: [0, 2, 3, 5, 7, 8, 10],
      chords: [
        [0, 2, 4],
        [5, 0, 2],
        [3, 5, 0],
      ],
      voices: [voice({ pattern: [0, 1, 2, 3, 4, null, 7, 5], octave: -1 }), voice({ pattern: [2, 0], octave: 2 })],
    });
    const classes = new Set(s.scale.map((step) => (s.root + step) % 12));
    const got = notes(s, 0, 96);
    expect(got.length).toBeGreaterThan(100);
    for (const n of got) {
      const midi = midiOf(n.frequency);
      expect(Math.abs(midi - Math.round(midi)), `beat ${n.beat} is not a note`).toBeLessThan(1e-9);
      expect(classes.has(((Math.round(midi) % 12) + 12) % 12), `beat ${n.beat} is out of the key`).toBe(true);
    }
  });

  it('is the same on every call: it holds no state', () => {
    const s = song({ voices: [voice({ pattern: [0, 2, null] })] });
    expect(notes(s, 3, 40).length).toBeGreaterThan(0);
    expect(notes(s, 3, 40)).toEqual(notes(s, 3, 40));
  });
});

describe('the stock song, calm', () => {
  it('passes checkSong', () => {
    expect(checkSong(calm)).toBeNull();
  });

  it('plays every voice over 64 beats', () => {
    const got = notes(calm, 0, 64);
    expect(got.length).toBeGreaterThan(0);
    for (let v = 0; v < calm.voices.length; v++) {
      expect(got.filter((n) => n.voice === v).length, `voice ${v} is silent`).toBeGreaterThan(0);
    }
  });

  it('keeps every note in its key, with every patch under 1.5 s', () => {
    const classes = new Set(calm.scale.map((step) => (calm.root + step) % 12));
    expect(notes(calm, 0, 64).length).toBeGreaterThan(0);
    for (const n of notes(calm, 0, 64)) expect(classes.has(Math.round(midiOf(n.frequency)) % 12)).toBe(true);
    // calm's voices are patches, whatever a voice may carry now
    for (const v of calm.voices) expect(duration(v.patch as Patch)).toBeLessThan(1.5);
  });
});

describe('checkSong', () => {
  const bad = (changes: Record<string, unknown>): string | null => checkSong({ ...song(), ...changes });
  const badVoice = (changes: Record<string, unknown>): string | null =>
    checkSong(song({ voices: [voice(), { ...voice(), ...changes }] }));

  it('accepts a sound song, and one with no voices', () => {
    expect(checkSong(song())).toBeNull();
    expect(checkSong(song({ voices: [] }))).toBeNull();
  });

  it('refuses what is not an object', () => {
    for (const v of [null, undefined, 3, 'song', [song()]]) expect(checkSong(v)).toMatch(/song/);
  });

  it('refuses a missing field by its name', () => {
    for (const key of Object.keys(song())) {
      const s: Record<string, unknown> = { ...song() };
      delete s[key];
      expect(checkSong(s), key).toContain(key);
    }
  });

  it('refuses a bpm not above 0, or not a number', () => {
    for (const v of [0, -90, NaN, Infinity, '90']) expect(bad({ bpm: v }), String(v)).toMatch(/^bpm/);
  });

  it('refuses a root that is not a MIDI note from 0 to 127', () => {
    for (const v of [-1, 128, 60.5, NaN, '60']) expect(bad({ root: v }), String(v)).toMatch(/^root/);
    expect(bad({ root: 0 })).toBeNull();
    expect(bad({ root: 127 })).toBeNull();
  });

  it('refuses a scale that is empty, not a list, or has a step out of 0..11', () => {
    for (const v of [[], 'major', [0, 12], [-1, 2], [0, 2.5], [0, NaN]]) {
      expect(bad({ scale: v }), JSON.stringify(v)).toMatch(/^scale/);
    }
  });

  it('refuses a scale that does not ascend, a repeated step included', () => {
    for (const v of [
      [0, 4, 2],
      [0, 2, 2],
      [3, 0],
    ])
      expect(bad({ scale: v }), JSON.stringify(v)).toMatch(/^scale/);
  });

  it('refuses chords that are empty, have an empty chord, or have a degree outside the scale', () => {
    for (const v of [[], [[]], [[0, 7]], [[-1]], [[0.5]], 'I', [3]]) {
      expect(bad({ chords: v }), JSON.stringify(v)).toMatch(/^chords/);
    }
    expect(bad({ chords: [[6]] })).toBeNull();
  });

  it('names the chord whose degree is wrong', () => {
    expect(bad({ chords: [[0], [0], [9]] })).toMatch(/chords\[2\]/);
  });

  it('refuses voices that are not a list', () => {
    expect(bad({ voices: 'one' })).toMatch(/^voices/);
    expect(bad({ voices: [null] })).toMatch(/voices\[0\]/);
  });

  it('refuses a voice whose patch fails checkPatch, naming the voice and the patch’s field', () => {
    expect(badVoice({ patch: { ...DEFAULT_PATCH, frequency: 0 } })).toMatch(/^voices\[1\]\.patch: frequency/);
    expect(badVoice({ patch: null })).toMatch(/^voices\[1\]\.patch/);
  });

  it('refuses a pattern that is empty, not a list, or holds a step that is not a degree or a rest', () => {
    for (const v of [[], 'x', [0, -1], [0.5], ['0'], [undefined], [NaN]]) {
      expect(badVoice({ pattern: v }), JSON.stringify(v)).toMatch(/^voices\[1\]\.pattern/);
    }
    expect(badVoice({ pattern: [null, 0, 12] })).toBeNull();
  });

  it('refuses an octave outside -4..4, or not whole', () => {
    for (const v of [-5, 5, 0.5, NaN, '1']) expect(badVoice({ octave: v }), String(v)).toMatch(/^voices\[1\]\.octave/);
    expect(badVoice({ octave: -4 })).toBeNull();
    expect(badVoice({ octave: 4 })).toBeNull();
  });

  it('refuses a gain outside 0..1', () => {
    for (const v of [-0.1, 1.1, NaN, Infinity, '1'])
      expect(badVoice({ gain: v }), String(v)).toMatch(/^voices\[1\]\.gain/);
    expect(badVoice({ gain: 0 })).toBeNull();
    expect(badVoice({ gain: 1 })).toBeNull();
  });

  it('reads a song that went through JSON as the same song', () => {
    expect(
      checkSong(
        JSON.parse(
          JSON.stringify({ ...calm, voices: calm.voices.map((v) => ({ ...v, patch: { ...v.patch, cutoff: 8000 } })) }),
        ),
      ),
    ).toBeNull();
  });
});
