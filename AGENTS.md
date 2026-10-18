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
`reverb`, the browser tests and the second size entry; part 6 those for `song`, `songs` and the song in the unchanged gate; part 7 those for `player`, `schedule` and the player's size entry; part 8 those for the bench, the pass's
findings and the pin.

## Commands

    npm run check:quick    prettier --check, tsc, eslint, node tests (the pre-commit hook; ~5 s)
    npm run check          the quick check, then the audio tests, the size gate and the bench (about 6 s)
    npm run size           gzipped bytes of each entry in scripts/size.ts, held to scripts/size-baseline.json and a budget
    SIZE_UPDATE=1 npm run size   writes the size baseline again, for a change meant to move it
    npm run bench          render time of each scene in scripts/bench.ts, held to scripts/bench-baseline.json and a budget
    npm run bench -- --update   writes the bench baseline again, on a quiet machine, for a change meant to move it
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

Three baselines exist: `scripts/size-baseline.json`, `test/unchanged.json` (`UNCHANGED_UPDATE=1 npm test`) and
`scripts/bench-baseline.json`; each is written again only for a change meant to move it, and the commit says why.

## Layout

All of it is in `PLAN.md`. All of it is built: `patch.ts`, `synth.ts`, `loudness.ts`, `patches.ts`, `reverb.ts`, `audio.ts`, `song.ts`, `songs.ts`,
`schedule.ts`, `player.ts`, the sheet in `sheet/`, and in `scripts/` the size gate and the bench (`bench.ts` times,
`bench-verdict.ts` judges, so that a node test holds the judging).

- `src/patch.ts`, `synth.ts`, `reverb.ts` (with the default room, `DEFAULT_REVERB`), `loudness.ts`, `song.ts`, `schedule.ts`: the thing itself. Pure functions over numbers and
  `Float32Array`s, no Web Audio, no clock, no `Math.random`. Chance comes in as an argument, `random?: () => number`.
- `src/patches.ts`, `songs.ts`: content, the stock patches and the one stock song, `calm`.
- `src/audio.ts`, `player.ts`: the picture, the only files that touch an `AudioContext` (`audio.ts` reads the context's clock through `Audio.time`; `player.ts` reads only that, to place a note). They take
  the context as an argument and never read a wall clock. `audio.ts` has the one `Math.random` fallback beside
  `synth.ts`'s, for a game that passes no `random`; the grep test in `test/synth.test.ts` names both.
- `sheet/`: a dev-only page (`index.html`, `sheet.ts`) to hear the stock sounds, with a slider per field, a seed box and a copy
  button that gives a TypeScript literal. No logic of its own; nothing in `src/` imports it. Held only by typecheck,
  lint and prettier: a person's ear holds the rest.
- Every file of `src/` is exported as `artshape-sound/<name>`, so a file added there is public API.

## Model features

For code, `src/loudness.ts` with `test/loudness.test.ts` is the smallest model, and `src/synth.ts` with
`test/synth.test.ts` the fuller (a seeded `random`, checks read back from the samples; `test/helpers.ts` has the
seeded source and the zero-crossing reader). For a gate, `scripts/size.ts`; for a timed one, `scripts/bench.ts` with its judging in `scripts/bench-verdict.ts` and `test/bench.test.ts`. A stock sound is the
model: `src/patches.ts` (the numbers),
`test/patches.test.ts` (its checks), `test/unchanged.json` (its samples, hashed), `test/fuzz.test.ts` (its rules at
random).

## Test API

`render(patch, sampleRate, random)` and `impulse(seconds, decay, sampleRate, random)` give samples that a node test reads
directly. `Audio` takes an `OfflineAudioContext` in a browser test (`test/audio.audio.test.ts`), which plays, renders with
`startRendering` and reads the channels back; `AudioOptions.destination` points the master gain at an `AnalyserNode` for
the one test on a real `AudioContext`. `Player` is stepped by `step(dt)`; on an offline context the clock moves only as it renders, so a test either reads what was scheduled by spying on `Audio.play` (`at` is the audio-clock time), or suspends the context at each step's time (`context.suspend`, a multiple of 128 frames), steps, and resumes, to render a song with the clock moving (`test/player.audio.test.ts`). The sums are held under node (`test/player.test.ts` over `src/schedule.ts`). There is no end-to-end test; the library has
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
- **the player:** (tested in `test/player.audio.test.ts`) `step(0)` (adds nothing), a huge dt (the beat moves, only a lookahead of notes near it is scheduled, never the skipped music), a paused game (`stop` keeps the beat; the next step goes on from it and plays nothing twice), a note further than two octaves from its voice's patch (played at the edge, `MAX_PITCH`), two players on one `Audio` (buffer names are numbered per player), a bad song or lookahead or dt (refused by name), a disposed `Audio` (`Audio.time` throws, so any step does), a note a frame late (played at once; `at` more than `LATE_TOLERANCE` in the past is refused)
- **overlapping voices:** Chrome sums a bus's inputs in an order it does not keep, so two renders of voices that overlap differ in the last bit of a float; the tests hold such renders to a part in a million, and byte for byte only where notes do not overlap
- **a context:** an `OfflineAudioContext` (`resume` is a no-op); Safari's `webkitAudioContext` is the game's to pass
- **saved:** nothing is saved; a patch and a song are JSON a game may keep, so a field added defaults to today's sound
- **scale:** many voices at once, which the capacity caps; what a render costs is the bench's
- **phone:** a slower machine renders slower at load; the bench holds how much, and the sample rate is the context's

## Gates

| Figure              | Budget                        | Baseline kept in              | Tolerance, and why it is that wide | Held by                  |
| ------------------- | ----------------------------- | ----------------------------- | ---------------------------------- | ------------------------ |
| stock sounds, notes | none: bit for bit             | `test/unchanged.json`         | none                               | `test/unchanged.test.ts` |
| render time         | a hard budget each, below     | `scripts/bench-baseline.json` | ±20% and a slack, both ways, below | `scripts/bench.ts`       |
| gzipped bytes       | measured plus half, per entry | `scripts/size-baseline.json`  | exact                              | `scripts/size.ts`        |

The size gate has three entries: `src/synth.ts` and what it imports, 1321 bytes gzipped, budget 1981; `src/audio.ts`
and what it imports (the synth, patch, loudness, reverb), 2786 bytes, budget 3775; and `src/player.ts`, 1916 bytes,
budget 2872. The player imports only a constant from `audio.ts`, so esbuild shakes the `Audio` class out of its bundle and
the figure is the player's own weight (with `song.ts`, `schedule.ts` and what they pull in), not audio plus player. An
entry is one line in `ENTRIES` in `scripts/size.ts`. The plan's guess of under
6 KiB for the effects path and 10 KiB for the whole is still a guess until those are measured. The unchanged gate: `test/unchanged.test.ts` renders each stock patch at 48000 from seed 20261018, hashes the
samples (FNV-1a) and holds them to `test/unchanged.json` exactly, and hashes the first 64 beats of `calm` as text, a
line a note (beat, voice, frequency to six decimals, gain), under `songs`; the patches a song's voices carry are not held; it is in `npm test`, so in the quick check.

The bench has thirteen scenes: `render` of each of the eleven stock patches at 48000 (a scene each, so that one patch's
cost moving is seen as that patch's), `impulse` of the default reverb, and `notes` of `calm` over 64 beats. Each runs
seven times fresh in a worker and the fastest counts, held as a multiple of a reference loop of filter and waveshaper
arithmetic, so a baseline written on one machine means something on another. It is held to 20% either way and to an
absolute slack, since a scene of a few hundredths of a millisecond wobbles by more than a fifth between quiet runs (jump
went from 0.070 to 0.098 ms): 0.05 ms for a render and the impulse, 0.002 ms for the notes. The hard budgets, which no
baseline excuses: 10 ms for a patch and for the impulse, 0.5 ms for the notes. Measured, the dearest patch (explode) takes
about 1.04 ms, the impulse 0.20 ms and the notes 0.004 ms, so the plan's guesses of under 20 and under 5 ms were an
order or more too loose and are replaced. The wobble of the unchanged code was measured over about ten benches: a few percent,
with the smallest patches (jump, pickup, click) up to 40%, which the slack takes. `bench-verdict.ts` is the judging (slower,
faster, invalid, within tolerance, and the budget) and `test/bench.test.ts` holds it.

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
read back in a test); the size and bench figures before and after (the bench's baseline written on a quiet machine, not while another bench or a build runs); no end-to-end or look point applies, there being no
page (said, not skipped). The pass is `npm run check` green, and the fuzzer over `FUZZ_SEEDS=1-2000` clean (about 4.5 s).

## What is not held

- The bench is one machine's, node's and not a browser's: it times `render`, `impulse` and `notes`, not `Audio.load`
  or a buffer being made on a phone's `AudioContext`. A slack hides a change in the smallest renders (a `click` or a
  `pickup`, under 0.07 ms) that is under about 0.05 ms; a doubling of those is not seen, though a doubling of anything
  dearer is. The size gate holds `src/synth.ts`, `src/audio.ts` and `src/player.ts` and not the sheet.
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

Nobody yet. The first game to pin it is the artshape template, in a feature of its own after v0.1.0. A game pins a
tag, `"artshape-sound": "github:onion2k/artshape-sound#v0.1.0"`, and imports `artshape-sound/audio`, `/player`,
`/patches` and `/songs`; the tag is moved on only by a commit that moves the pin and nothing else, and a tag that has been
pushed is never moved. What each game uses of it goes here when one does.
