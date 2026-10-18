// The stock song, as a model to copy: a game that wants its own music copies `calm` and changes a number. It is content
// and not logic, so nothing below this file imports it, and its notes are held bit for bit by test/unchanged.test.ts.
//
// C major at 90 beats a minute, one chord to a bar of four beats, going round I, V, vi, IV. The scale has seven degrees
// counted from 0, so those chords are degrees [0, 2, 4] (C E G), [4, 6, 1] (G B D), [5, 0, 2] (A C E) and [3, 5, 0]
// (F A C): song.ts says how a pattern step turns into a pitch. Every voice's patch lasts under a second, so a note is a
// note and not a wash, and each patch's frequency is near where its voice plays, so that a note asks for the patch to be
// bent only a little.

import { DEFAULT_PATCH } from './patch';
import type { Song } from './song';

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
