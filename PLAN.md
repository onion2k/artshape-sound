<!-- Copied unchanged from /Users/christopherneale/.claude/plans/clever-stirring-mango.md, the plan the user approved on 18 October 2026. -->

# artshape-sound: a plan

Sound effects and music for the artshape games, synthesised from a few
numbers at load so that no sound file is ever downloaded. A third package
beside artshape-render and artshape-physics, built to their shape, in a new
repo at `~/projects/artshape-sound` that the user creates.

This file is copied into the repo as `PLAN.md` as the first commit, and its
boxes are ticked as parts land with their checks green.

## Context

The games have no sound at all: nothing in the template, render or physics
touches audio. Sound files would cost download, and the template holds its
gzipped download to the byte (76,173 today, budget 400 KiB). Synthesised
sound costs code only, is the same every run, and can be stepped and read
back headless, so it fits the rules the games are already held to.

The library is built to the strongest sibling shape, physics: TypeScript
sources with no build, `"./*": "./src/*.ts"` exports, consumers pin a git
tag, eslint and prettier, vitest, a bench with a relative baseline, and a
hashed "unchanged" gate. From render it takes the node-versus-browser test
split (`*.test.ts` under node, `*.audio.test.ts` in headless Chromium
through vitest's Playwright provider). Unlike either sibling it takes the
guardrails kit (the user's choice), so its project file is `AGENTS.md`
with the kit's headings and `guardrails/` holds the rules.

Who builds it: this plan is well enough specified to be built on `sonnet`,
by the `builder` agent a part at a time or in a session switched to it.
This session cannot switch its own model.

## What it is, in a sentence each

- **A patch** is a dozen numbers that describe a sound: wave, pitch, slide,
  envelope, filter, noise, repeat. Named by what a player hears: `coin`,
  `hit`, `jump`, `bank`, `drop`.
- **The synth** turns a patch into samples, in plain TypeScript, with no
  Web Audio at all. Pure, seeded where it uses chance, and the same bits
  every run. This is the thing.
- **A song** is a tempo, a key, a chord list and a pattern per voice, in a
  small JSON shape. **The sequencer** turns a song and a beat range into
  notes, also pure.
- **The audio** is the picture: a class over an `AudioContext` that holds
  rendered buffers, plays them through a capped voice pool, a reverb made
  from a generated impulse and a compressor, and schedules song notes on
  the audio clock from game time stepped in. It never reads a wall clock
  and never calls `Math.random`.
- **The sheet** is a dev-only page that plays every stock patch and song
  with sliders, so a sound is heard and chosen before a game takes it, and
  tuned after.

## Layout

```
package.json          name artshape-sound, 0.1.0, MIT, type module, no main,
                      exports {"./package.json", "./*": "./src/*.ts"},
                      files [src, README.md, LICENSE]
tsconfig.json         as physics, plus lib DOM for the Web Audio types
eslint.config.js      as physics, typed rules on
.prettierrc           as physics: 120, singleQuote, trailingComma all
vitest.config.ts      node, test/**/*.test.ts
vitest.audio.config.ts browser, playwright chromium headless,
                      test/**/*.audio.test.ts, launch arg
                      --autoplay-policy=no-user-gesture-required
src/
  patch.ts            the Patch type, its defaults, and `checkPatch`
                      refusing what is out of range by field name
  synth.ts            render(patch, sampleRate, random) → Float32Array
  reverb.ts           impulse(seconds, decay, sampleRate, random) → Float32Array
  loudness.ts         peak(), rms(), normalise(samples, targetPeak)
  patches.ts          the stock patches, one export each, and ALL_PATCHES
  song.ts             the Song type, checkSong, notes(song, fromBeat, toBeat)
  songs.ts            one stock song, `calm`, as a model to copy
  audio.ts            class Audio: the Web Audio side
  player.ts           class Player: a song stepped by game time
test/
  *.test.ts           node tests, one file per src module
  unchanged.test.ts   hashes of every stock patch and the stock song's
                      first 64 beats, held bit for bit in unchanged.json
  fuzz.test.ts        random patches through render, invariants checked
  *.audio.test.ts     browser tests of Audio and Player
scripts/
  bench.ts            render time per stock patch, relative baseline
  bench-baseline.json
  size.ts             gzipped bytes of each entry bundled by esbuild,
                      held to a baseline exactly and a budget
  size-baseline.json
sheet/                index.html and sheet.ts, served by vite, dev only
AGENTS.md             the kit's headings, written from what the code does
CLAUDE.md, GEMINI.md  the kit's one-line pointers
guardrails/           the kit at v0.7.0, by INSTALL.md
.githooks/            pre-commit and commit-msg from the kit
.github/workflows/check.yml   dropped by the user after part 2: no CI
README.md, LICENSE, PLAN.md
```

## Interfaces

Everything takes what it needs as arguments. `random` follows physics:
`random?: () => number`, called each time, `Math.random` if not given. A
game passes its seeded source. Nothing in `src/` calls `Math.random`,
`Date.now` or `performance.now`; a test greps for it.

```ts
// patch.ts
export interface Patch {
  wave: 'sine' | 'square' | 'saw' | 'triangle' | 'noise';
  frequency: number;       // Hz at the start
  slide: number;           // Hz per second, may be negative
  attack: number;          // seconds
  sustain: number;
  release: number;
  punch: number;           // 0..1, extra gain over the sustain's start
  volume: number;          // 0..1 peak after normalising
  cutoff: number;          // lowpass Hz; Infinity means none
  cutoffSlide: number;     // Hz per second
  vibratoDepth: number;    // Hz
  vibratoRate: number;     // Hz
  noise: number;           // 0..1 mixed in
  repeat: number;          // Hz; 0 means once
  jitter: number;          // 0..1, how far pitch may wander per play
}
export const DEFAULT_PATCH: Patch;
export function checkPatch(p: unknown): string | null;   // a problem, named, or null

// synth.ts
export function render(patch: Patch, sampleRate: number, random?: () => number): Float32Array;
export function duration(patch: Patch): number;           // seconds, so a test can hold the length

// loudness.ts
export function peak(s: Float32Array): number;
export function rms(s: Float32Array): number;
export function normalise(s: Float32Array, targetPeak: number): Float32Array;

// song.ts
export interface Song {
  bpm: number;
  root: number;            // MIDI note of the key
  scale: readonly number[]; // semitone steps, e.g. [0,2,4,5,7,9,11]
  chords: readonly (readonly number[])[]; // degrees, one chord per bar
  voices: readonly Voice[];
}
export interface Voice { patch: Patch; pattern: readonly (number | null)[]; octave: number; gain: number; }
export interface Note { beat: number; frequency: number; voice: number; gain: number; }
export function checkSong(s: unknown): string | null;
export function notes(song: Song, fromBeat: number, toBeat: number): Note[];

// audio.ts
export interface AudioOptions {
  context: BaseAudioContext;  // AudioContext in a game, OfflineAudioContext in a test
  capacity?: number;          // voices at once, default 16; past it the oldest is cut
  random?: () => number;
  reverb?: { seconds: number; decay: number; send: number };
}
export class Audio {
  constructor(options: AudioOptions);
  load(name: string, patch: Patch): void;    // renders now, into a buffer
  play(name: string, options?: { gain?: number; pitch?: number; pan?: number }): void;
  resume(): Promise<void>;                   // on the first gesture; before it, play is silent and not queued
  mute(on: boolean): void;
  readonly voices: number;                   // playing now, for a test and a leak ceiling
  dispose(): void;
}

// player.ts
export class Player {
  constructor(audio: Audio, song: Song, options?: { lookahead?: number });
  step(dt: number): void;    // game time; schedules notes up to lookahead ahead on the audio clock
  readonly beat: number;
  stop(): void;
}
```

An unknown name in `play` is refused by name with a thrown `Error`, as
physics throws for an unusable terrain. A patch that fails `checkPatch` is
refused at `load`, never at `play`.

## The checks, and what each holds

| Check | Command | Holds |
| --- | --- | --- |
| quick check | `check:quick` | prettier, tsc, eslint, node tests, in that order; the pre-commit hook |
| node tests | `test` | each module's working parts, headless and seeded |
| unchanged | in `test` | every stock patch's samples and the stock song's notes, hashed, held bit for bit; `UNCHANGED_UPDATE=1` writes again |
| fuzz | in `test` | 200 random patches (`FUZZ_SEEDS=1-2000` for more): render never NaN, never outside [-1, 1], length equals `duration`, silent by the end |
| browser tests | `test:audio` | Audio and Player against an OfflineAudioContext and a real one |
| bench | `bench` | render time per stock patch and per second of song, relative to a reference loop as physics does, ±20%, with a hard budget each |
| size | `size` | gzipped bytes of `src/audio.ts` + deps and of `src/player.ts` + deps, bundled by esbuild, held exactly to a baseline; a budget each, set once measured |
| full check | `check` | quick, then audio, bench, size |

Budgets are measured before they are agreed. An estimate, called one: the
effects path under 6 KiB gzipped and the whole under 10 KiB. Part 2 writes
the real figure and the budget is set at that plus a half.

## Edge cases, for AGENTS.md and the tests

- a patch with zero attack, sustain and release: a buffer of length 0,
  refused by name
- `frequency` 0 or above the Nyquist for the sample rate, `cutoff` 0
- `jitter` with no `random` given, and with a seeded one: same seed, same
  samples
- sample rate 44100 and 48000: `duration` holds, `unchanged` is written
  at 48000 only and says so
- `play` before `resume`: silent, not queued, no error
- `play` at capacity: the oldest voice is cut, `voices` never exceeds it
- `play` after `dispose`: throws, by name
- `pitch` 0, negative, or 8: refused
- `step(0)`, `step` of a huge dt (a tab that slept): the player schedules
  only up to the lookahead, never a burst
- a paused game steps nothing, so the song stops at its beat and resumes
  from it
- a song with no voices, a pattern longer than its chords, a rest (`null`)
- a `Note` whose beat falls exactly on the range's edge: in `[from, to)`
- the context is an OfflineAudioContext: `resume` is a no-op and `play`
  works at once
- Safari's `webkitAudioContext`: the library takes a context, so that is
  the game's, and the README says so

## Parts, in the order they are built

Each part is built test first, with its tests seen failing, and ends with
`check:quick` green and its box ticked. The pass (the definition of done's
points 3 to 8) is run once, at part 8, before v0.1.0.

- [x] **1. The repo's shape.** package.json, tsconfig, eslint, prettier,
      vitest configs, LICENSE, a README stub, `.gitignore`, this file as
      PLAN.md, and the guardrails kit installed by `INSTALL.md` (merge
      style a merge commit, an agent may do nothing without asking, stale
      after 30 days). AGENTS.md written with the kit's headings from what
      exists, and marked as written. `check:quick` green on an empty
      `src/`. Check: `tests/run` in the kit's folder is not this project's
      gate; this project's is `npm run check:quick`.
- [x] **2. Patch and synth.** `patch.ts`, `synth.ts`, `loudness.ts`.
      Tests: `duration` against the envelope, a sine's frequency read back
      by zero crossings within 1%, `slide` moves it, `punch` raises the
      first peak, `cutoff` lowers energy above it (compare rms of the
      difference against an unfiltered render), `noise` is seeded, `repeat`
      gives that many onsets, `checkPatch` names each field it refuses,
      and the grep for clocks and `Math.random`. `size.ts` written here
      with its first figure and budgets set from it.
- [x] **3. Stock patches and the unchanged gate.** `patches.ts` with
      `coin`, `hit`, `jump`, `bank`, `drop`, `pickup`, `click`, `whoosh`,
      `powerup`, `fail`, `explode`. Test: every stock patch passes
      `checkPatch`, lasts under 1.5 s, has a peak of `volume` ± 0.01 and
      an rms within a band so no sound is far louder than another.
      `unchanged.test.ts` and `unchanged.json`, with a comment in the
      shape of physics' saying what wrote them. `fuzz.test.ts`.
- [x] **4. The sheet.** `sheet/` under vite, dev only: every stock patch
      with a button and a slider per field, a seed box, and a copy button
      that gives the patch as a TypeScript literal (JSON loses Infinity). **Stop here and put it to the user:**
      the stock sounds are a matter of taste, and only what they choose
      goes on. vite is a dev dependency taken in on purpose, in a commit
      of its own that says what it costs; render already has it.
- [x] **5. Audio.** `audio.ts` and `reverb.ts`. Browser tests against an
      OfflineAudioContext: a loaded patch played renders non-silence of
      the patch's length plus the reverb's tail, `gain` scales it, `pitch`
      shortens it, `pan` moves it between channels, capacity cuts the
      oldest and `voices` holds, `mute` gives silence, `dispose` then
      `play` throws, `play` before `resume` on a real context is silent.
      One test on a real `AudioContext` with the autoplay flag that `resume`
      resolves and `play` makes sound (read through an AnalyserNode).
- [x] **6. Song and sequencer.** `song.ts`, `songs.ts`. Tests: notes in
      `[from, to)`, every frequency in the key, a chord's degrees respected,
      rests give nothing, a pattern wraps, `checkSong` names each refusal,
      the stock song's first 64 beats join `unchanged.json`.
- [ ] **7. Player.** `player.ts`. Browser tests on an OfflineAudioContext
      with a stepped `currentTime`: `step` schedules within the lookahead
      and no further, `step(0)` schedules nothing new, a huge dt does not
      burst, `stop` leaves `beat` where it was, and a song played twice
      from the same beat on a fresh context renders the same bytes.
- [ ] **8. The pass, the bench and the release.** `bench.ts` and its
      baseline written on a quiet machine. No CI workflow (dropped). The pass of the definition of done, point by
      point in the report; mutation-check each new test by hand (the kit's
      hand check line). README filled: what it does, using it (the wiring
      a game does, in ten lines), checking it, licence. AGENTS.md's "Who
      uses it" says nobody yet. Version 0.1.0 committed alone and tagged
      `v0.1.0`, on the user's word.

## Out of scope, and next

- **Wiring a game.** A change belongs where the thing lives, so the
  template takes v0.1.0 in a feature of its own: the dependency pinned,
  `artshape-sound` added to `packages` in `vite.config.ts`, a `src/sound.ts`
  door as `physics.ts` is for physics, `main.ts` composing `Audio.play`
  into `GameEvents`, `resume` on the first key or pointer, a `sound ...`
  line in the event log so e2e tests assert what played without audio, a
  `voices` ceiling in `scripts/leaks.ts`, and `perf:update` through
  `/gate-moved` for the bytes it adds. A hit or bounce sound needs an event
  physics does not give yet, which is a physics feature first.
- **Music v0.2.0.** Procedural variation: a seeded next chord, a fill every
  n bars, a key change on a game event. Parts 6 and 7 leave the shape for
  it.
- **Not held here:** whether the sounds are good. Only the sheet and a
  person's ear hold that, at part 4 and again at part 8.

## Verifying the whole

From the repo root, after part 8:

```bash
npm run check
```

runs prettier, tsc, eslint, the node tests with the unchanged gate and the
fuzzer, the browser tests, the bench and the size gate. The sheet is seen
with `npm run sheet` in a headless Playwright page only to be measured;
listened to by the user in a real tab.
