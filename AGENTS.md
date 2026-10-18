# artshape-sound: working on it

Sound effects and music for browser games, synthesised from a few numbers at load so that no sound file is
downloaded: TypeScript sources with no build, taken in by a git tag. The README says what it is; this file says how it
is changed. The house rules in `~/.claude/CLAUDE.md` apply too.

Read guardrails/GUARDRAILS.md before changing anything: @guardrails/GUARDRAILS.md

**Written before the code.** This file was written on 18 October 2026 at the repo's first commit, from `package.json`,
the configs and `PLAN.md`, because `src/` is empty. Every line below about a module, a gate or a baseline is the plan's
and not yet the code's. Each part of the plan rewrites the lines it makes true, from what it built, and says so in its
commit.

## Commands

    npm run check:quick    prettier --check, tsc, eslint, node tests (the pre-commit hook; ~5 s)
    npm run check          the quick check, then the audio tests (bench and size join it at parts 2 and 8)
    npm test               the node tests, `test/**/*.test.ts`
    npm run test:audio     the audio tests, `test/**/*.audio.test.ts`, in headless Chromium (~? s, not yet measured)
    npm run typecheck      strict tsc, no emit
    npm run lint           eslint, the type-aware rules
    npm run format         prettier, writing: by hand, never by the hook
    CI                     .github/workflows/check.yml: `check:quick`, then the audio tests, on push to main and every PR
    mutate                 no mutation tool yet; the hand check stands in
    audit                  `npm audit --audit-level=high`, not yet a script
    updates                a bot for security updates only; versions by hand, monthly, a commit each

The audio tests need Playwright's Chromium: `npx playwright install chromium` once on a machine. There is no dev
server yet; part 4 adds the sheet under vite.

No baseline exists yet. The ones the plan names are `test/unchanged.json` (`UNCHANGED_UPDATE=1 npm test`),
`scripts/bench-baseline.json` and `scripts/size-baseline.json`; each is written again only for a change meant to move
it, and the commit says why.

## Layout

All of it is in `PLAN.md`; none of it is built yet except the configs.

- `src/patch.ts`, `synth.ts`, `reverb.ts`, `loudness.ts`, `song.ts`: the thing itself. Pure functions over numbers and
  `Float32Array`s, no Web Audio, no clock, no `Math.random`. Chance comes in as an argument, `random?: () => number`.
- `src/patches.ts`, `songs.ts`: content, the stock patches and the one stock song.
- `src/audio.ts`, `player.ts`: the picture, the only files that touch an `AudioContext`. They take the context as an
  argument and never read a wall clock.
- `sheet/`: a dev-only page to hear the stock sounds. No logic of its own.
- Every file of `src/` is exported as `artshape-sound/<name>`, so a file added there is public API.

## Model features

Nothing to copy yet. Once parts 2 and 3 land, a stock sound is the model: `src/patches.ts` (the numbers),
`test/patches.test.ts` (its checks), `test/unchanged.json` (its samples, hashed), `test/fuzz.test.ts` (its rules at
random).

## Test API

Nothing headless-visible beyond the functions themselves: `render(patch, sampleRate, random)` gives samples that a test
reads directly. `Audio` takes an `OfflineAudioContext` in a test, which is rendered and read back, and `Player` is
stepped by `step(dt)` with a context whose `currentTime` the test advances. There is no end-to-end test; the library has
no page of its own but the sheet.

## Edge cases

For anything new, check what it does:

- **a patch:** zero length, `frequency` 0 or past the Nyquist, `cutoff` 0, jitter with and without `random`, 44100 and
  48000 Hz
- **play:** before `resume` (silent, not queued), at capacity (the oldest is cut), after `dispose` (throws), `pitch` 0,
  negative or 8 (refused), an unknown name (throws, by name)
- **a song:** no voices, a pattern longer than its chords, a rest, a note on the range's edge (`[from, to)`)
- **the player:** `step(0)`, a huge dt, a paused game
- **a context:** an `OfflineAudioContext` (`resume` is a no-op); Safari's `webkitAudioContext` is the game's to pass
- **saved:** nothing is saved; a patch and a song are JSON a game may keep, so a field added defaults to today's sound
- **scale:** many voices at once, which the capacity caps; what a render costs is the bench's
- **phone:** a slower machine renders slower at load; the bench holds how much, and the sample rate is the context's

## Gates

| Figure                | Budget                        | Baseline kept in                       | Tolerance, and why it is that wide | Held by                  |
| --------------------- | ----------------------------- | -------------------------------------- | ---------------------------------- | ------------------------ |
| stock sounds' samples | none: bit for bit             | `test/unchanged.json` (part 3)         | none                               | `test/unchanged.test.ts` |
| render time           | a hard budget each (part 8)   | `scripts/bench-baseline.json` (part 8) | ±20%, to be measured               | `scripts/bench.ts`       |
| gzipped bytes         | measured at part 2, plus half | `scripts/size-baseline.json` (part 2)  | exact                              | `scripts/size.ts`        |

None of these exists yet. The sizes the plan guesses are under 6 KiB for the effects path and 10 KiB for the whole,
and are a guess until part 2 measures.

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
page (said, not skipped). The pass is `npm run check` green, and the fuzzer over `FUZZ_SEEDS=1-2000` clean.

## What is not held

- Everything under Gates, until its part lands.
- A mutation tool: the hand check alone stands in.
- The dependency audit, licence and unused-dependency scripts and their workflow, and the secret scan and code scanning
  in CI: not yet, and for the user to agree an order for.
- The look and end-to-end points, for want of a page.
- Whether the sounds are good: only the sheet and a person's ear hold that.
- The audio tests are measured on this machine and in CI only; Safari's and Firefox's Web Audio are not run.

## How a change lands

The rules are guardrails/GUARDRAILS.md's _Landing a change_. This project's answers:

- **Merge style:** a merge commit
- **What an agent may do without asking:** nothing
- **Stale after:** 30 days

Whether a change goes straight to the default branch or by PR is the remote's to say, by protecting the branch or not,
and is read from it each time.

## Who uses it

Nobody yet. The first game to pin it is the artshape template, in a feature of its own after v0.1.0.
