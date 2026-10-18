// The stock song, as a model to copy: a game that wants its own music copies `calm` and changes a number. It is content
// and not logic, so nothing below this file imports it, and its notes are held bit for bit by test/unchanged.test.ts.
//
// C major at 90 beats a minute, one chord to a bar of four beats, going round I, V, vi, IV. The scale has seven degrees
// counted from 0, so those chords are degrees [0, 2, 4] (C E G), [4, 6, 1] (G B D), [5, 0, 2] (A C E) and [3, 5, 0]
// (F A C): song.ts says how a pattern step turns into a pitch. Every voice's patch lasts under a second, so a note is a
// note and not a wash, and each patch's frequency is near where its voice plays, so that a note asks for the patch to be
// bent only a little.

import type { Layered } from './layers';
import { DEFAULT_PATCH } from './patch';
import type { Song, Voice } from './song';
import { epiano } from './sounds';

export const calm: Song = {
  bpm: 90,
  root: 60,
  scale: [0, 2, 4, 5, 7, 9, 11],
  chords: [
    [0, 2, 4],
    [4, 6, 1],
    [5, 0, 2],
    [3, 5, 0],
  ],
  voices: [
    // The bass: the chord's root two octaves down on the first beat and the third and fourth of each bar, a soft
    // triangle that gives the harmony its floor and leaves room above.
    {
      patch: {
        ...DEFAULT_PATCH,
        wave: 'triangle',
        frequency: 65.4,
        attack: 0.01,
        sustain: 0.3,
        release: 0.5,
        volume: 0.7,
      },
      pattern: [0, null, 0, 0],
      octave: -2,
      gain: 0.8,
    },
    // The pad: an arpeggio up the chord and back, a beat to a note, in a sine that the filter keeps dull, so it moves
    // without drawing the ear.
    {
      patch: {
        ...DEFAULT_PATCH,
        wave: 'sine',
        frequency: 262,
        attack: 0.02,
        sustain: 0.2,
        release: 0.7,
        volume: 0.5,
        cutoff: 2500,
      },
      pattern: [0, 1, 2, 3, 4, 3, 2, 1],
      octave: 0,
      gain: 0.5,
    },
    // The lead: a few notes an octave above the pad with a slow vibrato, sparse across four bars so that most beats
    // are rests, and the tune is a hint and not a melody.
    {
      patch: {
        ...DEFAULT_PATCH,
        wave: 'triangle',
        frequency: 523,
        attack: 0.03,
        sustain: 0.25,
        release: 0.6,
        volume: 0.4,
        vibratoDepth: 4,
        vibratoRate: 5,
      },
      pattern: [null, null, 2, null, 1, null, null, null, null, null, 0, null, 1, null, null, null],
      octave: 1,
      gain: 0.35,
    },
  ],
};

// ---- lounge ----
//
// The menus' loop: a lo-fi electric piano over a sub bass, a soft kick, a brushed snare and swung hats, at 82 beats a
// minute, four bars going round Fmaj9, Em7, Dm9 and Cmaj9. It is a song of layered voices and of the v0.3.0 song fields:
// two steps to a beat, so that the piano's second chord, the bass and the kick fall on the half beat; a piano chord
// strummed a few milliseconds a string, which is a voice a string, all of them the one `epiano` buffer; hats that swing
// and drums that are `fixed`. A voice's patch is rendered once whatever the song's length, so playing it costs a few
// milliseconds to load and nothing a beat, where the same four bars rendered as one loop cost a quarter of a second.
//
// How the notes are written. A pattern step is a place in the bar's chord and not a pitch, so a voicing is said as the
// MIDI notes it is, and `stepFor` works out the step that plays each (song.ts has the sum). The scale is C major and the
// chords its degrees, each bar's in the order its voicing climbs.

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ROOT = 60;
// The chord of each bar, as degrees of C major: F A C E G, E G B D, D F A C E and C E G B D.
const CHORDS = [
  [3, 5, 0, 2, 4],
  [2, 4, 6, 1],
  [1, 3, 5, 0, 2],
  [0, 2, 4, 6, 1],
];
// The notes each bar's piano chord is voiced as, low to high, and the root the bass plays under it.
const VOICINGS = [
  [53, 57, 60, 64, 67],
  [52, 55, 59, 62],
  [50, 53, 57, 60, 64],
  [48, 52, 55, 59, 62],
];
const BASS_ROOTS = [41, 40, 38, 36];
/** Steps in a bar, at two steps to a beat. */
const BAR = 8;

// The pattern step, in a chord, that plays the MIDI note `target` from a voice at `octave`: the place in the chord of its
// pitch class, with an octave carried for each time the chord has gone round.
function stepFor(chord: readonly number[], octave: number, target: number): number {
  for (let carry = 0; carry < 9; carry++)
    for (let i = 0; i < chord.length; i++)
      if (ROOT + 12 * (octave + carry) + MAJOR[chord[i]] === target) return i + chord.length * carry;
  throw new Error(
    `lounge: no step of the chord ${JSON.stringify(chord)} plays MIDI note ${target} from octave ${octave}`,
  );
}

// A pattern four bars long, with `at` giving the note for each bar (or null) at a step of the bar.
function bars(octave: number, step: number, note: (bar: number) => number | null): (number | null)[] {
  const pattern: (number | null)[] = new Array<number | null>(4 * BAR).fill(null);
  for (let bar = 0; bar < 4; bar++) {
    const target = note(bar);
    if (target !== null) pattern[bar * BAR + step] = stepFor(CHORDS[bar], octave, target);
  }
  return pattern;
}

// A sub bass at F2: a sine and its octave, each a soft push that falls over `beats` beats, cut at `length` seconds.
const bass = (beats: number, length: number): Layered => ({
  volume: 0.8,
  frequency: 87.31,
  layers: [
    { kind: 'tone', at: 0, gain: 1, f: 87.31, attack: 0.006, decay: (beats * 60) / 82, length, release: 0.08 },
    {
      kind: 'tone',
      at: 0,
      gain: 0.19,
      f: 174.62,
      attack: 0.006,
      decay: (beats * 30) / 82,
      length: length * 0.6,
      release: 0.08,
    },
  ],
});
// each is cut where the next note of the bass comes in over it, so the cut is not heard: the long note at the half beat
// after the second (1.83 s), the middle at the last half beat (1.28 s later), the short just before the bar's end
const bassLong = bass(1.6, 1.9);
const bassMid = bass(0.9, 1.2);
const bassShort = bass(0.4, 0.7);
// A kick: a sine that falls from 120 to 45 Hz in a few hundredths of a second.
const kick: Layered = {
  volume: 0.8,
  layers: [{ kind: 'tone', at: 0, gain: 1, f: 120, fEnd: 45, glide: 0.035, decay: 0.2, length: 0.6, release: 0.1 }],
};
// A brushed snare: a band of noise with a little body under it.
const snare: Layered = {
  volume: 0.8,
  layers: [
    {
      kind: 'noise',
      at: 0,
      gain: 0.14,
      filter: 'bandpass',
      f: 1900,
      q: 0.8,
      attack: 0.002,
      decay: 0.07,
      length: 0.35,
      release: 0.05,
    },
    { kind: 'tone', at: 0, gain: 0.06, f: 190, decay: 0.03 },
  ],
};
// A closed hat: a short tick of high noise.
const hat: Layered = {
  volume: 0.8,
  layers: [{ kind: 'noise', at: 0, gain: 1, filter: 'highpass', f: 7500, decay: 0.022, length: 0.12, release: 0.03 }],
};

// The piano's strings: a voice for each of the chord's five notes, so that each can be a few milliseconds after the one
// below it. 0.0164 of a beat is twelve milliseconds at 82 beats a minute.
const STRUM = 0.0164;
const strings = (step: number, gain: number): Voice[] =>
  [0, 1, 2, 3, 4].map((string) => ({
    patch: epiano,
    pattern: bars(-1, step, (bar) => VOICINGS[bar][string] ?? null),
    octave: -1,
    gain,
    offset: string * STRUM,
  }));

export const lounge: Song = {
  bpm: 82,
  root: ROOT,
  scale: MAJOR,
  chords: CHORDS,
  steps: 2,
  voices: [
    // the piano, struck on the first beat of each bar and softer on the half beat after the second
    ...strings(0, 0.1),
    ...strings(5, 0.07),
    // the bass: a long note on the root, a shorter on it on the half beat, and a short fifth above on the last
    { patch: bassLong, pattern: bars(-3, 0, (bar) => BASS_ROOTS[bar]), octave: -3, gain: 0.45 },
    { patch: bassMid, pattern: bars(-3, 5, (bar) => BASS_ROOTS[bar]), octave: -3, gain: 0.45 },
    { patch: bassShort, pattern: bars(-3, 7, (bar) => BASS_ROOTS[bar] + 7), octave: -3, gain: 0.4 },
    // the drums keep their own pitch: the kick on the first beat and the half beat after the second, the snare on the
    // second and fourth, the hats on every half beat, the off ones swung late
    { patch: kick, pattern: [0, null, null, null, null, 0, null, null], octave: 0, gain: 0.55, fixed: true },
    { patch: snare, pattern: [null, null, 0, null, null, null, 0, null], octave: 0, gain: 0.2, fixed: true },
    { patch: hat, pattern: [0, null], octave: 0, gain: 0.07, fixed: true },
    { patch: hat, pattern: [null, 0], octave: 0, gain: 0.05, fixed: true, swing: 0.2 },
  ],
};
