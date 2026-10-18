// The sound sheet: every stock patch with its numbers on sliders, to be heard in a tab and chosen between before the
// audio side is built on them. It is dev only and no part of the library: nothing in src/ imports it, and it holds no
// logic of its own beyond turning a click into a render and a render into a buffer. Without it the stock sounds could
// be judged only by reading their numbers.

import { checkPatch, DEFAULT_PATCH, WAVES, type Patch, type Wave } from '../src/patch';
import { ALL_PATCHES } from '../src/patches';
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
