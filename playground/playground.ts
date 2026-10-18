// The playground: the library wired the way a game wires it (one Audio over a real AudioContext, the stock sounds
// loaded, the calm and lounge songs on Players and the wind and birds on an Ambience, all stepped each frame) with a control for each thing a game can do to it, so that a
// person can hear what the browser tests only read back. It is dev only and no part of the library: nothing in src/
// imports it, and it holds no logic of its own beyond turning a click into a call and a call's result into a line.
// Without it a real AudioContext driving a player, a crowd through the compressor and volume on a live context would
// be heard by nobody before a game took the package in. The sheet is for tuning a sound; this is for using them.

import { Ambience } from '../src/ambience';
import { Audio, DEFAULT_CAPACITY, type Loop } from '../src/audio';
import { ALL_PATCHES } from '../src/patches';
import { Player } from '../src/player';
import { calm, lounge } from '../src/songs';
import { ALL_LAYERED, WIND_SECONDS } from '../src/sounds';

// The same small LCG as the sheet's, so a build from the same seed sounds the same. src/ has none, since the library
// takes its chance as an argument.
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}`);
  return found as T;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function log(line: string, error = false): void {
  const out = byId('log');
  const stamp = (performance.now() / 1000).toFixed(2).padStart(7);
  out.prepend(make('div', { className: error ? 'error' : '' }, `${stamp}  ${line}`));
}

// Every call to the library goes through here, so that what it throws is seen on the page and not only in the console.
function attempt(what: string, call: () => void): void {
  try {
    call();
  } catch (error) {
    log(`${what}: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

// A slider and the output beside it, read as a number.
function slider(id: string, onInput: (value: number) => void = () => {}): () => number {
  const input = byId<HTMLInputElement>(id);
  const out = input.parentElement?.querySelector('output');
  input.addEventListener('input', () => {
    if (out) out.value = input.value;
    onInput(Number(input.value));
  });
  return () => Number(input.value);
}

// The context is made at load, before any gesture, as a game's often is: so it starts suspended, and a sound played
// before resume can be heard not to play.
let context = new AudioContext();
let audio: Audio;
let player: Player;
let musicOn = false;
let lounger: Player;
let loungeOn = false;
let ambience: Ambience;
let ambienceOn = false;
let windLoop: Loop | null = null;

function build(): void {
  const seed = Number(byId<HTMLInputElement>('seed').value);
  const capacity = Number(byId<HTMLInputElement>('capacity').value) || DEFAULT_CAPACITY;
  const started = performance.now();
  audio = new Audio({
    context,
    random: lcg(seed),
    capacity,
    volume: Number(byId<HTMLInputElement>('volume').value),
    muted: byId('mute').textContent === 'unmute',
  });
  for (const [name, patch] of Object.entries(ALL_PATCHES)) audio.load(name, patch);
  // two takes of each layered sound, so that a repeat is heard to differ; the wind as a loop of its own
  for (const [name, sound] of Object.entries(ALL_LAYERED))
    audio.load(name, sound, name === 'wind' ? { loop: WIND_SECONDS } : { variants: 2 });
  player = new Player(audio, calm);
  lounger = new Player(audio, lounge);
  ambience = new Ambience(audio, { bed: 'wind', calls: ['birds'], random: lcg(seed + 1) });
  ambience.intensity = Number(byId<HTMLInputElement>('intensity').value);
  windLoop = null;
  log(
    `built: seed ${seed}, capacity ${capacity}, at ${context.sampleRate} Hz, in ${(performance.now() - started).toFixed(1)} ms`,
  );
}

attempt('build', build);
byId('not-running').remove();

byId('resume').addEventListener('click', () => {
  audio.resume().then(
    () => log(`resumed: the context is ${context.state}`),
    (error: unknown) => log(`resume: ${error instanceof Error ? error.message : String(error)}`, true),
  );
});

function stopEverything(): void {
  musicOn = false;
  loungeOn = false;
  ambienceOn = false;
  windLoop = null;
  byId('music').textContent = 'play';
  byId('lounge').textContent = 'play';
  byId('ambience').textContent = 'start';
}

byId('dispose').addEventListener('click', () => {
  audio.dispose();
  stopEverything();
  log('disposed: every call from here should throw, by name');
});

// A fresh context and a fresh Audio, for a new seed or capacity, or after a dispose.
byId('rebuild').addEventListener('click', () => {
  audio.dispose();
  void context.close();
  context = new AudioContext();
  stopEverything();
  attempt('build', build);
});

slider('volume', (value) => attempt('volume', () => (audio.volume = value)));

byId('mute').addEventListener('click', () => {
  const button = byId('mute');
  const on = button.textContent === 'mute';
  attempt('mute', () => {
    audio.mute(on);
    button.textContent = on ? 'unmute' : 'mute';
  });
});

byId('bad-volume').addEventListener('click', () => attempt('volume = 1.5', () => (audio.volume = 1.5)));

const pitch = slider('pitch');
const pan = slider('pan');
const gain = slider('gain');
const sweep = byId<HTMLInputElement>('sweep');

// With the sweep on, each play steps the pan across a little, so that a run of plays is heard moving left to right.
let sweepAt = -1;
function nextPan(): number {
  if (!sweep.checked) return pan();
  sweepAt = sweepAt >= 1 ? -1 : Math.min(1, sweepAt + 0.25);
  return sweepAt;
}

function play(name: string): void {
  attempt(`play "${name}"`, () => {
    const before = context.state;
    audio.play(name, { pitch: pitch(), pan: nextPan(), gain: gain() });
    if (before !== 'running') log(`play "${name}" while ${before}: silent, and not queued`);
  });
}

for (const name of Object.keys(ALL_LAYERED)) {
  if (name === 'wind') continue; // a bed, heard under "A loop" and "Ambience"
  const pad = make('button', { type: 'button', textContent: name });
  pad.addEventListener('click', () => play(name));
  byId('layered-pads').append(pad);
}

const burstSound = byId<HTMLSelectElement>('burst-sound');
for (const name of Object.keys(ALL_PATCHES)) {
  const pad = make('button', { type: 'button', textContent: name });
  pad.addEventListener('click', () => play(name));
  byId('pads').append(pad);
  burstSound.append(make('option', { value: name, textContent: name }));
}

// More at once than the capacity, so the oldest is cut and the compressor has a crowd to hold.
byId('fire-burst').addEventListener('click', () => {
  const count = Number(byId<HTMLInputElement>('burst').value);
  for (let i = 0; i < count; i++) play(burstSound.value);
  log(`burst of ${count} "${burstSound.value}": ${audio.voices} voices playing`);
});

byId('bad-pitch').addEventListener('click', () => attempt('play at pitch 5', () => audio.play('coin', { pitch: 5 })));
byId('unknown').addEventListener('click', () => attempt('play "nope"', () => audio.play('nope')));

const loopGain = slider('loop-gain', (value) => {
  if (windLoop) windLoop.gain = value;
});
byId('loop-start').addEventListener('click', () => {
  attempt('loop wind', () => {
    windLoop = audio.loop('wind', { gain: loopGain() });
    log(
      windLoop.playing ? `wind looping: ${audio.loops} loops` : 'wind: the context is not running, so no loop was made',
    );
  });
});
byId('loop-stop').addEventListener('click', () => {
  windLoop?.stop();
  windLoop = null;
  log('wind stopped (twice is harmless)');
});

const intensity = slider('intensity', (value) => attempt('intensity', () => (ambience.intensity = value)));
byId('ambience').addEventListener('click', () => {
  ambienceOn = !ambienceOn;
  if (ambienceOn) ambience.start();
  else ambience.stop();
  byId('ambience').textContent = ambienceOn ? 'stop' : 'start';
  log(ambienceOn ? `ambience started at intensity ${intensity()}` : 'ambience stopped');
});

byId('lounge').addEventListener('click', () => {
  loungeOn = !loungeOn;
  if (!loungeOn) lounger.stop();
  byId('lounge').textContent = loungeOn ? 'pause' : 'play';
  log(loungeOn ? `lounge on from beat ${lounger.beat.toFixed(2)}` : `lounge paused at beat ${lounger.beat.toFixed(2)}`);
});
byId('lounge-restart').addEventListener('click', () => {
  attempt('lounge from the start', () => {
    lounger = new Player(audio, lounge);
    log('lounge back to beat 0');
  });
});

byId('music').addEventListener('click', () => {
  musicOn = !musicOn;
  if (!musicOn) player.stop();
  byId('music').textContent = musicOn ? 'pause' : 'play';
  log(musicOn ? `music on from beat ${player.beat.toFixed(2)}` : `music paused at beat ${player.beat.toFixed(2)}`);
});

byId('restart').addEventListener('click', () => {
  attempt('from the start', () => {
    player = new Player(audio, calm);
    log('music back to beat 0');
  });
});

// One step of five seconds, as a tab that slept or a debugger would give: the beat should jump and only the notes
// near the new beat be heard, not a burst of the music skipped.
byId('long-frame').addEventListener('click', () => {
  attempt('step(5)', () => {
    const from = player.beat;
    player.step(5);
    log(`step(5): beat ${from.toFixed(2)} to ${player.beat.toFixed(2)}`);
  });
});

const speed = slider('speed');

byId('clear-log').addEventListener('click', () => byId('log').replaceChildren());

// The game's frame: the time since the last one, scaled by the speed slider, stepped into the player while the music is
// on. A hidden tab gets no frames, so coming back hands the player one long step, which is the case it is built for.
let last = performance.now();
function frame(now: number): void {
  const dt = ((now - last) / 1000) * speed();
  last = now;
  // A step that throws turns the music off, so that one fault is one line in the log and not one a frame.
  if (musicOn)
    attempt('step', () => {
      try {
        player.step(dt);
      } catch (error) {
        musicOn = false;
        byId('music').textContent = 'play';
        throw error;
      }
    });
  // The same for the lounge and the ambience: one fault turns it off, and is one line in the log.
  if (loungeOn)
    attempt('lounge step', () => {
      try {
        lounger.step(dt);
      } catch (error) {
        loungeOn = false;
        byId('lounge').textContent = 'play';
        throw error;
      }
    });
  if (ambienceOn)
    attempt('ambience step', () => {
      try {
        ambience.step(dt);
      } catch (error) {
        ambienceOn = false;
        byId('ambience').textContent = 'start';
        throw error;
      }
    });
  byId('state').textContent = context.state;
  byId('clock').textContent = context.currentTime.toFixed(3);
  try {
    byId('voices').textContent = String(audio.voices);
    byId('loops').textContent = String(audio.loops);
  } catch {
    byId('voices').textContent = byId('loops').textContent = 'disposed';
  }
  byId('beat').textContent = player.beat.toFixed(2);
  try {
    byId('volume-read').textContent = String(audio.volume);
    byId('muted-read').textContent = String(audio.muted);
  } catch {
    byId('volume-read').textContent = byId('muted-read').textContent = 'disposed';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
