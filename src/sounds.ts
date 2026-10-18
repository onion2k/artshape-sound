// The stock layered sounds: the handful a golf game, or any game with a place to it, wants beyond a beep. Each is a
// complete Layered named by what a player hears and built from numbers heard in the sketch they come from: a wooden
// knock, a struck marimba bar, an electric piano, a bell, a splash, applause, wind and a bird. They are content and
// not logic, so nothing below this file imports them, and a game that wants its own sound copies one and changes a
// number. They are held bit for bit by test/unchanged.test.ts, and each is rendered in under 10 ms (the bench's hard
// budget), which is why a marimba bar is cut at two seconds and a crowd is a few filtered bands.
//
// The pitched ones (marimba, epiano, bell) carry a `frequency`, the pitch they are rendered at, so that a song or a
// game bends them to a note by playing the buffer faster or slower. Bending moves the whole sound with the pitch, so a
// note within an octave of its sound is the way to use them.

import type { Layered } from './layers';

// A rail, a post, a flipper: a click, and the short ringing of a wooden thing struck. Played louder or softer by gain.
export const wood: Layered = {
  volume: 0.7,
  jitter: 0.05,
  layers: [
    { kind: 'noise', at: 0, gain: 0.5, filter: 'highpass', f: 1500, decay: 0.002 },
    {
      kind: 'modes',
      at: 0,
      gain: 1,
      length: 0.2,
      modes: [
        [480, 0.045, 0.4],
        [1150, 0.022, 0.25],
        [2350, 0.01, 0.15],
        [3700, 0.006, 0.08],
      ],
    },
  ],
};

// A marimba bar at C5: its fundamental, and the near-fourth and near-tenth overtones that a tuned bar rings with, and
// a faint octave that dies at once for the mallet.
export const marimba: Layered = {
  volume: 0.6,
  frequency: 523.25,
  layers: [
    {
      kind: 'modes',
      at: 0,
      gain: 1,
      length: 2.2,
      release: 0.1,
      modes: [
        [523.25, 0.45, 1],
        [2056.3, 0.06, 0.25],
        [4970.9, 0.015, 0.08],
      ],
    },
    { kind: 'tone', at: 0, gain: 0.15, f: 1046.5, decay: 0.004 },
  ],
};

// An electric piano note at C4: frequency modulation with the modulator at the carrier's own pitch, whose bend falls as
// the note rings and leaves a little behind it, a short bark at the strike as a tine gives, and a slow tremolo as the
// amplifier's.
export const epiano: Layered = {
  volume: 0.8,
  frequency: 261.63,
  layers: [
    {
      kind: 'fm',
      at: 0,
      gain: 1,
      f: 261.63,
      ratio: 1,
      index: 1.2,
      indexDecay: 0.3,
      indexFloor: 0.2,
      bark: { ratio: 14, amount: 0.3, decay: 0.012 },
      attack: 0.003,
      decay: 1.6,
      length: 1.7,
      release: 0.25,
      tremolo: { rate: 4.5, depth: 0.12 },
    },
  ],
};

// A bell at C7: a carrier and an inharmonic modulator whose depth dies away, for the shimmer that settles to a clean ring.
export const bell: Layered = {
  volume: 0.5,
  frequency: 2093,
  layers: [
    {
      kind: 'fm',
      at: 0,
      gain: 1,
      f: 2093,
      ratio: 3.5,
      index: 2.2,
      indexDecay: 0.36,
      attack: 0.002,
      decay: 1.2,
      length: 3.5,
      release: 0.4,
    },
  ],
};

// A ball into water: the impact, the plop of a cavity closing with its pitch rising, a hiss, and the bubbles after.
export const splash: Layered = {
  volume: 0.7,
  jitter: 0.03,
  layers: [
    { kind: 'noise', at: 0, gain: 0.8, f: 2600, fEnd: 500, decay: 0.12 },
    { kind: 'tone', at: 0.01, gain: 0.35, f: 260, fEnd: 750, glide: 0.04, decay: 0.05 },
    { kind: 'noise', at: 0.01, gain: 0.08, filter: 'highpass', f: 3500, attack: 0.01, decay: 0.2 },
    {
      kind: 'bubbles',
      at: 0.03,
      gain: 0.13,
      count: 30,
      spread: 0.6,
      f: 500,
      ratio: 4.5,
      rise: 1.6,
      glide: 0.012,
      decay: 0.02,
    },
  ],
};

// A crowd: quick to swell and slow to die, a few seconds of it. Played softer for polite applause, and given a larger
// `gain` or a second copy for a fuller house.
export const applause: Layered = {
  volume: 0.6,
  layers: [{ kind: 'claps', at: 0, gain: 1, seconds: 3, rate: 150, low: 900, high: 2600 }],
};

/** The length of loop the wind is made for, in seconds. It renders in about six milliseconds; a longer loop costs more in
 * proportion, and the gusts' cycles are whole numbers, so that they divide a loop of any whole number of seconds. */
export const WIND_SECONDS = 4;

// Wind in the grass and the trees, to be rendered as a loop (`Audio.load(name, wind, { loop: WIND_SECONDS })`) and
// played by an `Ambience`: low noise whose level and brightness swell with two gusts, one over the whole loop and one
// three times over it, and a breath of leaves above it that comes only with the strongest. The `length` of a bed is not
// used by a loop, which spans the whole of it.
export const wind: Layered = {
  volume: 0.5,
  layers: [
    {
      kind: 'noise',
      at: 0,
      gain: 0.35,
      f: 450,
      q: 0.6,
      steady: true,
      length: WIND_SECONDS,
      gusts: [
        { cycles: 1, depth: 0.45 },
        { cycles: 3, depth: 0.35 },
      ],
      gustBrighten: 1.5,
    },
    {
      kind: 'noise',
      at: 0,
      gain: 0.05,
      filter: 'highpass',
      f: 4500,
      q: 0.7,
      steady: true,
      length: WIND_SECONDS,
      gusts: [
        { cycles: 1, depth: 0.45 },
        { cycles: 3, depth: 0.35 },
      ],
      gustPower: 4,
    },
  ],
};

// One call of a bird a way off: four chirps climbing in pitch, each with the quiver a throat gives, a little further
// apart and quieter as they go. Loaded with variants, its jitter makes each a different bird, and an `Ambience` plays
// it now and then.
export const birds: Layered = {
  volume: 0.3,
  jitter: 0.2,
  layers: [
    {
      kind: 'bounces',
      at: 0,
      gain: 1,
      count: 4,
      gap: 0.12,
      shrink: 1.1,
      fade: 0.85,
      scatter: 0.25,
      layers: [
        {
          kind: 'tone',
          at: 0,
          gain: 1,
          f: 3200,
          fEnd: 4600,
          glide: 0.03,
          attack: 0.004,
          decay: 0.02,
          length: 0.07,
          release: 0.02,
          vibrato: { rate: 50, depth: 0.03 },
        },
      ],
    },
  ],
};

// Every stock layered sound by name, for the sheet, a test or a game that loads them all. A name added above is added
// here, and the tests hold the two together.
export const ALL_LAYERED = {
  wood,
  marimba,
  epiano,
  bell,
  splash,
  applause,
  wind,
  birds,
} as const satisfies Readonly<Record<string, Layered>>;

export type LayeredName = keyof typeof ALL_LAYERED;
