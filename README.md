# artshape-sound

Sound effects and music for a browser game, made from a few numbers at load so that no sound file is downloaded. It is
the third package beside [artshape-render](https://github.com/onion2k/artshape-render) and
[artshape-physics](https://github.com/onion2k/artshape-physics), built to their shape.

## What it does

A sound is a **patch**: about fifteen numbers (a wave, a pitch and how it slides, an envelope, a filter, some noise, a
repeat) that `render` turns into samples in plain TypeScript, with no Web Audio and no clock, so the same patch and the
same seed give the same bits on every machine. A **song** is a tempo, a key, a chord to a bar and a pattern for each
voice, and `notes` turns it and a range of beats into the notes that fall in that range, also pure. `Audio` is the Web
Audio side, the only part that touches a browser: it renders patches into buffers, plays them through a capped pool of
voices with pan, pitch and gain, a small reverb made from a generated impulse and a compressor that holds a crowd from
clipping. `Player` steps a song by the game's own time and schedules each note on the audio clock a moment ahead, so
that a slow frame does not make the music stumble and a paused game stops it where it was.

A sound can also be **layered** (since 0.3.0): a list of layers mixed into one buffer, each a kind of its own (a tone
with a glide, filtered noise with a sweep, a bank of ringing modes, FM, grains, a crowd's claps, bubbles, a set of
bounces, or a patch), so that a club meeting a ball, a ball rattling into a cup or a splash sounds like the thing and
not like a beep. `Ambience` is a looped bed whose level follows an intensity, with calls at a seeded random rate.

The cost is code, not download: about 8 kilobytes gzipped for the effects path with layered sounds, 1.3 for the synth
alone and 4 for the player, each held to the byte by `npm run size`, which prints the figure. A stock patch renders in
about a millisecond at most on a desktop, once, at load, and a stock layered sound in under 10 ms (the dearest, a 4 s
loop of wind, about 7).

## Using it

    npm install github:onion2k/artshape-sound#v0.3.0

It ships TypeScript sources rather than a build, and expects a bundler that compiles them, Vite as the other two do.
Every file in `src/` is a public path: `artshape-sound/audio`, `artshape-sound/patches`, `artshape-sound/player`.

The wiring a game does, in about ten lines:

```ts
import { Audio } from 'artshape-sound/audio';
import { ALL_PATCHES } from 'artshape-sound/patches';
import { Player } from 'artshape-sound/player';
import { calm } from 'artshape-sound/songs';

const audio = new Audio({ context: new AudioContext(), random: game.random }); // your seeded source, if you have one
for (const [name, patch] of Object.entries(ALL_PATCHES)) audio.load(name, patch);
addEventListener('pointerdown', () => void audio.resume(), { once: true }); // a browser starts a context only on a gesture
game.on('coin', () => audio.play('coin', { pitch: 1 + game.combo * 0.05, pan: game.panOf(coin) }));
const music = new Player(audio, calm);
function frame(dt: number) {
  music.step(dt); // dt in seconds of game time: a paused game steps nothing, and the music waits
}
```

Things to know:

- **Make the context yourself.** The library takes a context and never makes one. That is what lets a test hand it an
  `OfflineAudioContext`, and it means Safari, whose older versions have only `webkitAudioContext`, is the game's to construct: make
  whichever the browser has and pass it in.
- **Nothing sounds before `resume`.** A browser keeps a context suspended until a click or a key. Until then `play` is
  silent and is not queued, so a sound fired on the title screen is not heard late. Call `resume` on the first gesture.
- **A pitch is clamped to what the buffer can bend.** `play` takes a `pitch` above 0 and up to 4, and refuses anything
  else by name. The player bends one rendered buffer to each note, so a voice's patch is to be tuned near where it plays;
  a note more than two octaves from it is played at the edge, not refused.
- **Volume and mute are two settings.** `new Audio({ context, volume: 0.5, muted: false })` or `audio.volume = 0.5` sets the
  master volume, 0 to 1 (anything else is refused by name), and `audio.mute(true)` / `audio.muted` silence it without
  losing the volume, which comes back on unmute. The defaults are full volume and not muted. The library keeps nothing:
  a game keeps the setting in its own save and passes it back in when it builds the `Audio`.
- **A mistake is thrown, by name.** An unknown sound, a patch with a field out of range, a `pan` outside -1 to 1, a
  disposed `Audio` and a bad song each throw an `Error` that says which.
- **A patch kept as JSON loses `cutoff: Infinity`** to `null`, which `checkPatch` refuses. Put it back when you load.

## The stock sounds

Each is a patch in `artshape-sound/patches`, named by what a player hears, and `ALL_PATCHES` has them all. A game that
wants its own copies one and changes a number.

| Name      | What it is                                                           |
| --------- | -------------------------------------------------------------------- |
| `coin`    | a bright square blip that climbs and is struck again: money, a point |
| `hit`     | a short thump of noise that the filter closes on: a blow landing     |
| `jump`    | a square wave that climbs quickly: a hop off the ground              |
| `bank`    | a warm, ringing triangle: a score banked, a sum paid in              |
| `drop`    | a slide down and a soft tail: something dropped or let go            |
| `pickup`  | a short rise of a clean square: an item taken up, a key collected    |
| `click`   | the shortest sine that is still heard: a button pressed              |
| `whoosh`  | noise that opens and closes: something fast passing, a swipe, a dash |
| `powerup` | a saw that sweeps a long way up with a little wobble: a bonus won    |
| `fail`    | a square sliding down and fading: a mistake, a life lost             |
| `explode` | a long burst of noise under a slow falling filter: a bomb, a crash   |

Two songs in `artshape-sound/songs`. `calm`: C major at 90 beats a minute, going round four chords with a bass, a pad
and a sparse lead. `lounge`: an electric piano over a sub bass, a soft kick, a brushed snare and swung hats, at 82, going
down Fmaj9, Em7, Dm9 and Cmaj9. Each is a model to copy: a game that wants its own music changes the numbers.

## Layered sounds

    import { Audio } from 'artshape-sound/audio';
    import { Ambience } from 'artshape-sound/ambience';
    import { splash, wind, birds, WIND_SECONDS } from 'artshape-sound/sounds';

    audio.load('splash', splash, { variants: 3 }); // three takes from the seeded source, played in turn
    audio.load('wind', wind, { loop: WIND_SECONDS }); // rendered to come round with no seam
    audio.load('bird', birds, { variants: 4 });
    audio.play('splash');
    const place = new Ambience(audio, { random, bed: 'wind', calls: ['bird'] });
    place.start();
    place.intensity = 0.6; // the bed fades to it; step(dt) by game time, as the player is

A `Layered` is `{ layers, volume, frequency?, jitter? }`, and every layer has `kind`, `at` (seconds) and `gain`. The
kinds and their own fields are in `src/layers.ts`, each with its unit and default beside it. `checkLayered` refuses a
bad one by the path of its field (`layers[2].q`), and `renderLayered(sound, sampleRate, random)` gives its samples,
the same bits for the same seed. `frequency` is the pitch a pitched sound is rendered at, so a song or a game bends it to
a note; `jitter` detunes each take a little, so a sound repeated is not the same twice. A layered sound has no
`Infinity` in it and so survives JSON as it is. `Audio.loop(name, { gain })` plays a sound loaded with `{ loop }` until
its handle's `stop()`, and is outside the voice pool. A song's voice may carry a layered sound, and a song may have
`steps` a beat with `swing`, and voices that are `fixed` (a drum, at its own pitch) or `offset` (a strum).

| Name       | What it is                                                               |
| ---------- | ------------------------------------------------------------------------ |
| `wood`     | a click and the short ringing of a wooden thing struck: a rail, a post   |
| `marimba`  | a marimba bar at C5, with the overtones a tuned bar has                  |
| `epiano`   | an electric piano note at C4: FM with a bark at the strike and a tremolo |
| `bell`     | an FM bell, for shimmer                                                  |
| `splash`   | an impact, a plop and bubbles rising: something into water               |
| `applause` | a polite crowd: claps in three bands, swelling and dying                 |
| `wind`     | two beds of noise that gust, for a loop of `WIND_SECONDS`                |
| `birds`    | a chirp train a way off, a different bird each take                      |

## The sheet

    npm run sheet

serves a dev-only page at http://localhost:5182/ that has every stock sound with a slider for each number, a seed box,
a play button and a copy button. Tuning a sound is: pick the one nearest what you want, play it, move sliders until it
is right, and press copy, which puts the patch on the clipboard as a TypeScript literal (JSON would lose `Infinity`).
Paste that into your game as a `Patch` and `audio.load` it. The sheet is not part of the package.

    npm run playground

serves a second dev-only page at http://localhost:5183/, for trying the library by hand the way a game uses it: one
`Audio` over a real `AudioContext` with every stock sound loaded, and `calm` on a `Player` stepped each frame. It has a
pad for each sound with pitch, pan and gain sliders, a burst past the voice cap, volume and mute, the song played,
paused and handed a five-second frame, dispose and build again, and a log of what each call did or threw. The context
is made at load, so a sound played before resume can be heard not to play.

## Checking it

    npm run check:quick   formatting, types, lint and the node tests; the pre-commit hook, about 5 seconds
    npm test              the node tests: each module headless and seeded, the stock sounds and the song's notes
                          held bit for bit (test/unchanged.json), and a fuzzer of random patches (200 by default,
                          FUZZ_SEEDS=1-2000 for more)
    npm run test:audio    the Web Audio tests, in headless Chromium (npx playwright install chromium, once)
    npm run size          gzipped bytes of the synth, the audio path and the player, held exactly and to a budget
    npm run bench         the render time of each stock sound, the reverb and the song's notes, held to a baseline
                          as a multiple of a reference loop, to 20% either way, and to a hard budget
    npm run check         all of these, in that order

There is no CI: the project is checked on the machine it is made on.

## What is not held

- **Whether the sounds are good.** Only the sheet and a person's ear hold that.
- **Any browser but Chromium.** The audio tests run in headless Chromium alone; Safari's and Firefox's Web Audio are not
  run, and a real `AudioContext` driving a player is not run either, only an offline one stepped by hand.
- **How a crowd of voices sounds** through the compressor. It is tested only as far as one quiet voice passing through it
  untouched.
- **A mutation tool.** A test is mutation-checked by hand, and no tool counts survivors yet.

## Licence

MIT, see [LICENSE](LICENSE).
