// The sound sheet: every stock patch with its numbers on sliders, to be heard in a tab and chosen between before the
// audio side is built on them. It is dev only and no part of the library: nothing in src/ imports it, and it holds no
// logic of its own beyond turning a click into a render and a render into a buffer. Without it the stock sounds could
// be judged only by reading their numbers.

import { Audio } from '../src/audio';
import { checkLayered, layeredSeconds, renderLayered, renderLoop, type Layered } from '../src/layers';
import { checkPatch, DEFAULT_PATCH, WAVES, type Patch, type Wave } from '../src/patch';
import { ALL_PATCHES } from '../src/patches';
import { Player } from '../src/player';
import { lounge } from '../src/songs';
import { ALL_LAYERED, WIND_SECONDS } from '../src/sounds';
import { duration, render } from '../src/synth';

// A small LCG, so a play with jitter or noise is the same every time for the same seed in the box. The tests have
// their own in test/helpers.ts; src/ has none, since the library takes its chance as an argument.
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

type NumericField = Exclude<keyof Patch, 'wave'>;

// The slider's reach for each field. All lie inside checkPatch's range and hold every stock value; a patch tuned past
// them is typed into a copy by hand.
const RANGES: Record<NumericField, { min: number; max: number; step: number }> = {
  frequency: { min: 20, max: 4000, step: 1 },
  slide: { min: -5000, max: 5000, step: 10 },
  attack: { min: 0, max: 2, step: 0.005 },
  sustain: { min: 0, max: 2, step: 0.005 },
  release: { min: 0, max: 2, step: 0.005 },
  punch: { min: 0, max: 1, step: 0.01 },
  volume: { min: 0, max: 1, step: 0.01 },
  cutoff: { min: 50, max: 20000, step: 50 },
  cutoffSlide: { min: -20000, max: 20000, step: 100 },
  vibratoDepth: { min: 0, max: 100, step: 1 },
  vibratoRate: { min: 0, max: 40, step: 0.5 },
  noise: { min: 0, max: 1, step: 0.01 },
  repeat: { min: 0, max: 40, step: 0.5 },
  jitter: { min: 0, max: 1, step: 0.01 },
};

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

// One AudioContext, made on the first click because a browser will not start audio without a gesture.
let context: AudioContext | null = null;

function play(patch: Patch, when = 0): void {
  context ??= new AudioContext();
  void context.resume();
  const seed = Number(byId<HTMLInputElement>('seed').value);
  const samples = render(patch, context.sampleRate, lcg(seed));
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(context.currentTime + when);
}

// The patch as the TypeScript a game would paste: only what differs from DEFAULT_PATCH, in the shape of
// src/patches.ts. Not JSON, which would turn `cutoff: Infinity` into null.
function toSource(name: string, patch: Patch): string {
  const lines = ['  ...DEFAULT_PATCH,'];
  for (const key of Object.keys(DEFAULT_PATCH) as (keyof Patch)[]) {
    if (patch[key] === DEFAULT_PATCH[key]) continue;
    const value = key === 'wave' ? `'${patch.wave}'` : String(patch[key]);
    lines.push(`  ${key}: ${value},`);
  }
  return `export const ${name}: Patch = {\n${lines.join('\n')}\n};\n`;
}

// Round to the slider's step, so a copied patch reads 0.35 and not 0.35000000000000003.
function snap(field: NumericField, value: number): number {
  const { step } = RANGES[field];
  return Number((Math.round(value / step) * step).toPrecision(10));
}

// A row's patch is read from its controls and so can never drift from what is shown. Each row returns what play-all
// needs: a way to read its patch.
function buildRow(name: string, stock: Patch): () => Patch {
  const state: Patch = { ...stock };
  const error = make('p', { className: 'error' });
  const inputs = new Map<NumericField, HTMLInputElement>();
  const outputs = new Map<NumericField, HTMLOutputElement>();
  let noCutoff: HTMLInputElement | null = null;
  const waveSelect = make('select');
  for (const w of WAVES) waveSelect.append(make('option', { value: w, textContent: w }));

  const refresh = (): void => {
    waveSelect.value = state.wave;
    for (const [field, input] of inputs) {
      const infinite = field === 'cutoff' && state.cutoff === Infinity;
      input.value = String(infinite ? RANGES.cutoff.max : state[field]);
      input.disabled = infinite;
      const out = outputs.get(field);
      if (out) out.value = infinite ? 'none' : String(state[field]);
    }
    if (noCutoff) noCutoff.checked = state.cutoff === Infinity;
    error.textContent = checkPatch(state);
  };

  const fields = make('div', { className: 'fields' });
  fields.append(make('label', {}, 'wave', waveSelect, make('span')));
  waveSelect.addEventListener('change', () => {
    state.wave = waveSelect.value as Wave;
    refresh();
  });

  for (const field of Object.keys(RANGES) as NumericField[]) {
    const { min, max, step } = RANGES[field];
    const input = make('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const out = make('output');
    inputs.set(field, input);
    outputs.set(field, out);
    input.addEventListener('input', () => {
      state[field] = snap(field, Number(input.value));
      refresh();
    });
    const label = make('label', {}, field, input, out);
    if (field === 'cutoff') {
      // Infinity is a real cutoff (no filter) that no slider position can say, so it gets a box of its own.
      noCutoff = make('input', { type: 'checkbox' });
      noCutoff.addEventListener('change', () => {
        state.cutoff = noCutoff?.checked ? Infinity : snap('cutoff', Math.min(stock.cutoff, RANGES.cutoff.max));
        refresh();
      });
      label.append(make('span'), make('label', { className: 'tick' }, noCutoff, 'no filter'));
    }
    fields.append(label);
  }

  const reset = make('button', { type: 'button', textContent: 'reset' });
  reset.addEventListener('click', () => {
    Object.assign(state, stock);
    refresh();
  });
  const copy = make('button', { type: 'button', textContent: 'copy' });
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(toSource(name, state)).then(() => {
      copy.textContent = 'copied';
      setTimeout(() => (copy.textContent = 'copy'), 1200);
    });
  });
  const playButton = make('button', { type: 'button', textContent: 'play' });
  playButton.addEventListener('click', () => {
    if (checkPatch(state) === null) play(state);
  });

  byId('rows').append(
    make('section', {}, make('div', {}, make('h2', { textContent: name }), playButton, copy, reset), fields, error),
  );
  refresh();
  return () => state;
}

const readers = Object.entries(ALL_PATCHES).map(([name, patch]) => ({ name, read: buildRow(name, patch) }));

// Reseeding changes the one number in the box; the next play draws from it afresh.
byId('reseed').addEventListener('click', () => {
  byId<HTMLInputElement>('seed').value = String(Math.floor(Math.random() * 1e9));
});

// Each patch in turn, half a second after the last one ends, all queued on the context's clock.
byId('play-all').addEventListener('click', () => {
  let at = 0;
  for (const { read } of readers) {
    const patch = read();
    if (checkPatch(patch) !== null) continue;
    play(patch, at);
    at += duration(patch) + 0.5;
  }
});

// ---- the layered sounds ----
//
// Every stock layered sound with a button to hear it, and the song `lounge`. They have no sliders: a layered sound is
// dozens of numbers, and the way to change one is to copy its source from src/sounds.ts. What is heard here is what the
// library renders: a sound from `renderLayered` with the seed in the box (so a repeat is another take if the seed is
// changed), the wind as the loop it is made for, the pitched ones bent by the semitones slider, and the song through a
// Player stepped by the frame, as a game steps it.

const semitones = byId<HTMLInputElement>('semitones');
semitones.addEventListener('input', () => {
  const out = semitones.parentElement?.querySelector('output');
  if (out) out.value = semitones.value;
});

// A button that plays the sound once, or for a bed starts and stops its loop, and says how long it took to render.
function layeredRow(name: string, sound: Layered): void {
  const status = make('span', { className: 'status' });
  const isLoop = name === 'wind';
  let looping: AudioBufferSourceNode | null = null;
  const button = make('button', { type: 'button', textContent: isLoop ? 'start loop' : 'play' });
  button.addEventListener('click', () => {
    context ??= new AudioContext();
    void context.resume();
    if (looping) {
      looping.stop();
      looping = null;
      button.textContent = 'start loop';
      return;
    }
    const seed = Number(byId<HTMLInputElement>('seed').value);
    const started = performance.now();
    let samples: Float32Array;
    try {
      samples = isLoop
        ? renderLoop(sound, WIND_SECONDS, context.sampleRate, lcg(seed))
        : renderLayered(sound, context.sampleRate, lcg(seed));
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    status.textContent = `rendered in ${(performance.now() - started).toFixed(1)} ms`;
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = isLoop;
    // only a sound with a pitch of its own can be bent to a note
    if (sound.frequency !== undefined) source.playbackRate.value = 2 ** (Number(semitones.value) / 12);
    source.connect(context.destination);
    source.start();
    if (isLoop) {
      looping = source;
      button.textContent = 'stop loop';
    }
  });
  const length = isLoop ? `a ${WIND_SECONDS} s loop` : `${layeredSeconds(sound).toFixed(2)} s`;
  const pitch = sound.frequency === undefined ? '' : `, at ${sound.frequency} Hz`;
  byId('layered').append(
    make(
      'section',
      {},
      make('div', {}, make('h2', { textContent: name }), button, make('span', { textContent: `${length}${pitch}` })),
      status,
      make('p', { className: 'error', textContent: checkLayered(sound) ?? '' }),
    ),
  );
}
for (const [name, sound] of Object.entries(ALL_LAYERED)) layeredRow(name, sound);

// The lounge: an Audio and a Player on the page's context, stepped by the animation frame with the time between frames.
function loungeRow(): void {
  const status = make('span', { className: 'status' });
  const button = make('button', { type: 'button', textContent: 'play' });
  let player: Player | null = null;
  let last = 0;
  const frame = (now: number): void => {
    if (!player) return;
    // the frame's own timestamp can be a hair before the click's, so the time is held at 0 from below
    player.step(Math.max(0, Math.min((now - last) / 1000, 0.25)));
    last = now;
    status.textContent = `beat ${player.beat.toFixed(1)}`;
    requestAnimationFrame(frame);
  };
  button.addEventListener('click', () => {
    context ??= new AudioContext();
    void context.resume();
    if (player) {
      player = null;
      button.textContent = 'play';
      return;
    }
    const seed = Number(byId<HTMLInputElement>('seed').value);
    const started = performance.now();
    player = new Player(new Audio({ context, random: lcg(seed) }), lounge);
    status.textContent = `voices loaded in ${(performance.now() - started).toFixed(1)} ms`;
    button.textContent = 'stop';
    last = performance.now();
    requestAnimationFrame(frame);
  });
  byId('layered').append(
    make(
      'section',
      {},
      make('div', {}, make('h2', { textContent: 'lounge' }), button, make('span', { textContent: 'a song, 82 bpm' })),
      status,
    ),
  );
}
loungeRow();
