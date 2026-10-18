# artshape-sound: working on it

Sound effects and music for browser games, synthesised from a few numbers at load so that no sound file is
downloaded: TypeScript sources with no build, taken in by a git tag. The README says what it is; this file says how it
is changed. The house rules in `~/.claude/CLAUDE.md` apply too.

Read guardrails/GUARDRAILS.md before changing anything: @guardrails/GUARDRAILS.md

**Written before the code.** This file was written on 18 October 2026 at the repo's first commit, from `package.json`,
the configs and `PLAN.md`, because `src/` was empty. Every line below about a module, a gate or a baseline that has not
been built yet is the plan's and not yet the code's. Each part of the plan rewrites the lines it makes true, from what it
built, and says so in its commit. Part 2 rewrote the lines for `patch`, `synth`, `loudness`, the size gate and the
patch edge cases; part 3 those for the stock patches, the unchanged gate and the fuzzer; part 5 those for `audio`,
`reverb`, the browser tests and the second size entry; part 6 those for `song`, `songs` and the song in the unchanged gate.

## Commands

    npm run check:quick    prettier --check, tsc, eslint, node tests (the pre-commit hook; ~5 s)
    npm run check          the quick check, then the audio tests, then the size gate (the bench joins it at part 8)
    npm run size           gzipped bytes of each entry in scripts/size.ts, held to scripts/size-baseline.json and a budget
    SIZE_UPDATE=1 npm run size   writes the size baseline again, for a change meant to move it
    npm test               the node tests, `test/**/*.test.ts`
    npm run test:audio     the audio tests, `test/**/*.audio.test.ts`, in headless Chromium (~2 s)
    npm run sheet          vite on sheet/, http://localhost:5182/: every stock patch with sliders, to be heard in a tab
    npm run typecheck      strict tsc, no emit
    npm run lint           eslint, the type-aware rules
    npm run format         prettier, writing: by hand, never by the hook
    CI                     none, by the user's choice: the project is checked locally, with `npm run check`
    mutate                 no mutation tool yet; the hand check stands in
    audit                  `npm audit --audit-level=high`, not yet a script
    updates                a bot for security updates only; versions by hand, monthly, a commit each

The audio tests need Playwright's Chromium: `npx playwright install chromium` once on a machine. The only dev
server is the sheet, under vite.

Two baselines exist: `scripts/size-baseline.json` and `test/unchanged.json` (`UNCHANGED_UPDATE=1 npm test`). The other
the plan names is `scripts/bench-baseline.json`; each is written again only for a change meant to
move it, and the commit says why.

## Layout

All of it is in `PLAN.md`. Built so far: `patch.ts`, `synth.ts`, `loudness.ts`, `patches.ts` (with `size.ts` in `scripts/`), `reverb.ts`, `audio.ts`, `song.ts`, `songs.ts`, and the sheet in `sheet/`; the rest is
the plan's.

- `src/patch.ts`, `synth.ts`, `reverb.ts`, `loudness.ts`, `song.ts`: the thing itself. Pure functions over numbers and
  `Float32Array`s, no Web Audio, no clock, no `Math.random`. Chance comes in as an argument, `random?: () => number`.
- `src/patches.ts`, `songs.ts`: content, the stock patches and the one stock song, `calm`.
- `src/audio.ts`, `player.ts`: the picture, the only files that touch an `AudioContext` (`player.ts` not yet). They take
  the context as an argument and never read a wall clock. `audio.ts` has the one `Math.random` fallback beside
  `synth.ts`'s, for a game that passes no `random`; the grep test in `test/synth.test.ts` names both.
- `sheet/`: a dev-only page (`index.html`, `sheet.ts`) to hear the stock sounds, with a slider per field, a seed box and a copy
  button that gives a TypeScript literal. No logic of its own; nothing in `src/` imports it. Held only by typecheck,
  lint and prettier: a person's ear holds the rest.
- Every file of `src/` is exported as `artshape-sound/<name>`, so a file added there is public API.

## Model features

For code, `src/loudness.ts` with `test/loudness.test.ts` is the smallest model, and `src/synth.ts` with
`test/synth.test.ts` the fuller (a seeded `random`, checks read back from the samples; `test/helpers.ts` has the
seeded source and the zero-crossing reader). For a gate, `scripts/size.ts`. A stock sound is the
model: `src/patches.ts` (the numbers),
`test/patches.test.ts` (its checks), `test/unchanged.json` (its samples, hashed), `test/fuzz.test.ts` (its rules at
random).

## Test API

`render(patch, sampleRate, random)` and `impulse(seconds, decay, sampleRate, random)` give samples that a node test reads
directly. `Audio` takes an `OfflineAudioContext` in a browser test (`test/audio.audio.test.ts`), which plays, renders with
`startRendering` and reads the channels back; `AudioOptions.destination` points the master gain at an `AnalyserNode` for
the one test on a real `AudioContext`. `Player` is
stepped by `step(dt)` with a context whose `currentTime` the test advances. There is no end-to-end test; the library has
no page of its own but the sheet.

## Edge cases

For anything new, check what it does:

- **a patch:** (`test/fuzz.test.ts` draws 200 at random by default, `FUZZ_SEEDS=1-2000` for more, at 44100 and 48000)
  zero length (all of attack, sustain and release 0: refused), `frequency` 0 or at or past the Nyquist
  (`checkPatch` refuses 0, `render` the Nyquist), `cutoff` 0 (refused) or `Infinity` (no filter), a total over 10 s
  (refused), jitter with and without `random` (a draw of 0.5 is no change), 44100 and 48000 Hz (`Math.round(duration *
sampleRate)` samples, the last exactly 0). A patch kept as JSON loses `cutoff: Infinity` to `null`, which
  `checkPatch` refuses by name, so a game restores it.
- **play:** before `resume` (silent, not queued; built and tested), at capacity (the oldest is cut; tested), after
  `dispose` (throws; tested), `pitch` 0, negative or above 4 (refused; `MAX_PITCH` is 4, not the plan's 8), `pan` outside
  [-1, 1] and a negative `gain` (refused), an unknown name (throws, by name)
- **a song:** (tested in `test/song.test.ts`) no voices (no notes), a pattern longer than its chords (it carries into the next
  octave), a rest, a note on the range's edge (`[from, to)`), a beat before 0 (chords and patterns go round both ways), a
  range that is not finite (`notes` throws by name), a chord degree past the scale or a descending scale (`checkSong`
  refuses by field)
- **the player:** `step(0)`, a huge dt, a paused game
- **a context:** an `OfflineAudioContext` (`resume` is a no-op); Safari's `webkitAudioContext` is the game's to pass
- **saved:** nothing is saved; a patch and a song are JSON a game may keep, so a field added defaults to today's sound
- **scale:** many voices at once, which the capacity caps; what a render costs is the bench's
- **phone:** a slower machine renders slower at load; the bench holds how much, and the sample rate is the context's

## Gates

| Figure              | Budget                        | Baseline kept in                       | Tolerance, and why it is that wide | Held by                  |
| ------------------- | ----------------------------- | -------------------------------------- | ---------------------------------- | ------------------------ |
| stock sounds, notes | none: bit for bit             | `test/unchanged.json`                  | none                               | `test/unchanged.test.ts` |
| render time         | a hard budget each (part 8)   | `scripts/bench-baseline.json` (part 8) | ±20%, to be measured               | `scripts/bench.ts`       |
| gzipped bytes       | measured plus half, per entry | `scripts/size-baseline.json`           | exact                              | `scripts/size.ts`        |

The size gate has two entries: `src/synth.ts` and what it imports, 1321 bytes gzipped, budget 1981; and `src/audio.ts`
and what it imports (the synth, patch, loudness, reverb), 2517 bytes, budget 3775. An entry is one line in `ENTRIES` in
`scripts/size.ts`; part 7 adds `src/player.ts`. The plan's guess of under
6 KiB for the effects path and 10 KiB for the whole is still a guess until those are measured. The unchanged gate exists: `test/unchanged.test.ts` renders each stock patch at 48000 from seed 20261018, hashes the
samples (FNV-1a) and holds them to `test/unchanged.json` exactly, and hashes the first 64 beats of `calm` as text, a
line a note (beat, voice, frequency to six decimals, gain), under `songs`; the patches a song's voices carry are not held; it is in `npm test`, so in the quick check. The
bench does not exist yet.

- **Audit threshold:** high and critical fail; moderate is reported; an exception is written with why, and looked at
  again within 90 days.
- **Allowed licences:** MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0, 0BSD, Unlicense; anything else asked about by
  name.
- **Surviving mutants:** no mutation tool yet, said under What is not held.
- **Accepted findings:** none yet.

## Done, here

The definition of done's nine points, in this project: unit tests in `test/<module>.test.ts` and the browser ones in
`test/*.audio.test.ts`; a sound that is an input to a rule goes in the fuzzer (`test/fuzz.test.ts`) with its rule; a
stock patch or song goes into `test/unchanged.json`; a cap for anything kept (the voice pool's capacity, with `voices`
read back in a test); the size and bench figures before and after; no end-to-end or look point applies, there being no
page (said, not skipped). The pass is `npm run check` green, and the fuzzer over `FUZZ_SEEDS=1-2000` clean (about 4.5 s).

## What is not held

- The render-time gate, until part 8 lands; the size gate holds `src/synth.ts` and `src/audio.ts` so far.
- A mutation tool: the hand check alone stands in.
- CI of any kind (the user chose local checks only), so the checks run only where someone runs them, and the secret
  scan and code scanning that would need it. The dependency audit, licence and unused-dependency scripts: not yet, and for the user to agree an order for.
- The look and end-to-end points, for want of a page.
- Whether the sounds are good: only the sheet and a person's ear hold that.
- The audio tests are measured on this machine only, in Chromium alone; Safari's and Firefox's Web Audio are not run. The
  compressor's levelling is held only as far as a single quiet voice passing through it linearly; how a crowd sounds is
  for the ear.

## How a change lands

The rules are guardrails/GUARDRAILS.md's _Landing a change_. This project's answers:

- **Merge style:** a merge commit
- **What an agent may do without asking:** nothing
- **Stale after:** 30 days

Whether a change goes straight to the default branch or by PR is the remote's to say, by protecting the branch or not,
and is read from it each time.

## Who uses it

Nobody yet. The first game to pin it is the artshape template, in a feature of its own after v0.1.0.
