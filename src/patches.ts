// The stock sounds: the usual handful a small game wants, each a complete patch built from DEFAULT_PATCH and named by
// what a player hears. Without them every game would tune its own coin from nothing. They are content and not logic,
// so nothing below this file imports them, and a game that wants its own sound copies one and changes a number. They
// are held bit for bit by test/unchanged.test.ts: a sound that is to change is a change meant to move the hashes.
//
// Built the classic sfxr way: a square wave with a step in pitch for a coin, noise under a falling filter for a blow,
// a long slide up for a power-up. Every one lasts under a second and a half.

import { DEFAULT_PATCH, type Patch } from './patch';

// A bright square blip that climbs and is struck again, nine times a second: money, a point, a gem.
export const coin: Patch = {
  ...DEFAULT_PATCH,
  wave: 'square',
  frequency: 988,
  slide: 1400,
  attack: 0,
  sustain: 0.05,
  release: 0.2,
  punch: 0.3,
  volume: 0.5,
  repeat: 9,
};

// A short thump of noise that the filter closes on: a blow landing, a bullet striking.
export const hit: Patch = {
  ...DEFAULT_PATCH,
  wave: 'noise',
  frequency: 180,
  slide: -200,
  attack: 0,
  sustain: 0.04,
  release: 0.16,
  punch: 0.6,
  volume: 0.6,
  cutoff: 4000,
  cutoffSlide: -15000,
};

// A square wave that climbs quickly: a hop off the ground.
export const jump: Patch = {
  ...DEFAULT_PATCH,
  wave: 'square',
  frequency: 280,
  slide: 700,
  attack: 0,
  sustain: 0.08,
  release: 0.14,
  punch: 0.2,
  volume: 0.4,
};

// A warm, ringing triangle with a touch of shimmer: a score banked, a sum paid in.
export const bank: Patch = {
  ...DEFAULT_PATCH,
  wave: 'triangle',
  frequency: 660,
  slide: 300,
  attack: 0.005,
  sustain: 0.18,
  release: 0.5,
  punch: 0.25,
  volume: 0.5,
  vibratoDepth: 12,
  vibratoRate: 14,
};

// A slide down and a soft tail: something dropped, a piece set down, a ball let go.
export const drop: Patch = {
  ...DEFAULT_PATCH,
  wave: 'sine',
  frequency: 600,
  slide: -900,
  attack: 0,
  sustain: 0.06,
  release: 0.22,
  punch: 0.2,
  volume: 0.5,
};

// A short rise of a clean square: an item taken up, a key collected.
export const pickup: Patch = {
  ...DEFAULT_PATCH,
  wave: 'square',
  frequency: 520,
  slide: 1800,
  attack: 0,
  sustain: 0.03,
  release: 0.12,
  punch: 0.4,
  volume: 0.4,
};

// The shortest sine that is still heard: a button pressed, a menu item chosen.
export const click: Patch = {
  ...DEFAULT_PATCH,
  wave: 'sine',
  frequency: 1500,
  slide: -4000,
  attack: 0,
  sustain: 0.005,
  release: 0.025,
  punch: 0.3,
  volume: 0.4,
};

// Noise that opens and then closes, with a rising then falling filter: something fast passing, a swipe, a dash.
export const whoosh: Patch = {
  ...DEFAULT_PATCH,
  wave: 'noise',
  frequency: 700,
  attack: 0.12,
  sustain: 0.05,
  release: 0.25,
  punch: 0,
  volume: 0.4,
  cutoff: 300,
  cutoffSlide: 6000,
  noise: 0.4,
};

// A saw that sweeps a long way up with a little wobble: a bonus won, a level gained.
export const powerup: Patch = {
  ...DEFAULT_PATCH,
  wave: 'saw',
  frequency: 220,
  slide: 900,
  attack: 0,
  sustain: 0.3,
  release: 0.2,
  punch: 0.3,
  volume: 0.4,
  cutoff: 6000,
  vibratoDepth: 25,
  vibratoRate: 18,
};

// A square sliding down and fading: a mistake, a life lost, a try that did not work.
export const fail: Patch = {
  ...DEFAULT_PATCH,
  wave: 'square',
  frequency: 360,
  slide: -420,
  attack: 0.005,
  sustain: 0.25,
  release: 0.35,
  punch: 0.2,
  volume: 0.4,
  cutoff: 3000,
  vibratoDepth: 8,
  vibratoRate: 9,
};

// A long burst of noise under a slow falling filter, with a low rumble in it: a bomb, a crash, a thing destroyed.
export const explode: Patch = {
  ...DEFAULT_PATCH,
  wave: 'noise',
  frequency: 70,
  slide: -40,
  attack: 0.005,
  sustain: 0.15,
  release: 0.9,
  punch: 0.8,
  volume: 0.7,
  cutoff: 3500,
  cutoffSlide: -3000,
  noise: 0.3,
  jitter: 0.2,
};

// Every stock patch by name, for a sheet, a test or a game that loads them all. A name added above is added here, and
// the test holds the two together.
export const ALL_PATCHES = {
  coin,
  hit,
  jump,
  bank,
  drop,
  pickup,
  click,
  whoosh,
  powerup,
  fail,
  explode,
} as const satisfies Readonly<Record<string, Patch>>;

export type PatchName = keyof typeof ALL_PATCHES;
