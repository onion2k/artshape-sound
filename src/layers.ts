// A layered sound is a list of layers rendered and mixed into one buffer: a club face is a click, a ringing bank of
// modes, a thump and a breath of air, each its own kind of layer, and none of them is a patch's one oscillator through
// one filter. Like a patch it is a handful of numbers, rendered in plain TypeScript with no Web Audio, so it can be
// hashed and read back under node and is the same bits on every machine. Chance enters only as the `random` argument,
// which is required here: a layered sound is rendered by `Audio`, which passes its own, and nothing in this file reads
// the global source.
//
// checkLayered is the one door a layered sound comes through. It may be written by hand, kept as JSON or pasted from
// the sheet, so it is read as if anyone had written it, and what is out of range is refused by the path of its field
// (`layers[3].q`), as checkPatch refuses a patch's. Nothing in a layered sound is Infinity, so it survives JSON.
//
// How it is made. Each layer is drawn into a buffer of its own, scaled by its `gain` and added at its `at`. The sum
// is soft-clipped (softClip, a rational stand-in for tanh), so that a crowd of layers bends and does not crack, the
// last sample is set to 0, and the peak is brought to `volume`. The draws of `random` come in a fixed order: the
// jitter once at the start, then each layer's in the order the layers are listed.

import { biquad, FILTERS, type FilterKind } from './filter';
import { normalise } from './loudness';
import { checkPatch, MAX_SECONDS, type Patch } from './patch';
import { duration, render } from './synth';

/** A slow swell in the level, `cycles` of it over the layer, `depth` of the level either way. */
export interface Gust {
  cycles: number;
  depth: number;
}
/** A wobble: `rate` Hz, `depth` as a share of the thing it moves. */
export interface Wobble {
  rate: number;
  depth: number;
}
/** One ringing sine of a bank: its frequency in Hz, its decay (the time constant of its fall) and its amplitude. */
export type Mode = [frequency: number, decay: number, amplitude: number];

interface Timed {
  /** Seconds from the start of the sound at which the layer starts. */
  at: number;
  /** How loud the layer is in the mix, 0 to 10; the mix is then soft-clipped and brought to the sound's volume. */
  gain: number;
}
/** The shape in time that tone, noise and fm share: a rise, a hold, an exponential fall, an optional cut-off. */
interface Tail {
  attack?: number; // seconds, default 0.0008
  sustain?: number; // seconds held at the full level before the fall, default 0
  length?: number; // seconds after which the layer is cut, faded over `release`; default 7 decays, where it is inaudible
  release?: number; // seconds of the fade at `length`, default 0.02
}

export interface ToneLayer extends Timed, Tail {
  kind: 'tone';
  wave?: 'sine' | 'square' | 'saw' | 'triangle'; // default 'sine'
  f: number; // Hz at the start
  fEnd?: number; // Hz the pitch glides to; default f
  glide?: number; // time constant of the glide in seconds; default decay
  decay: number; // time constant of the fall in seconds
  vibrato?: Wobble; // depth as a share of the pitch, fading with the tone
  tremolo?: Wobble; // depth as a share of the level
}
export interface NoiseLayer extends Timed, Tail {
  kind: 'noise';
  filter?: FilterKind; // default 'lowpass'
  f: number; // the corner, or the centre of a band, in Hz
  fEnd?: number; // where the corner has swept to by the end of the layer; default f
  q?: number; // default 0.707
  decay?: number; // time constant of the fall; required unless the layer is steady
  steady?: boolean; // a bed: the level holds for `length` (required) and, in a loop, for the whole loop
  gusts?: Gust[]; // slow swells of the level and the corner; added together as 1 + sum of depth * sin
  gustPower?: number; // the level follows the gust to this power; default 1
  gustBrighten?: number; // octaves the corner rises for each unit the gust is above 1; default 0
}
export interface ModesLayer extends Timed {
  kind: 'modes';
  modes: Mode[];
  attack?: number;
  length?: number;
  release?: number;
}
export interface FmLayer extends Timed, Tail {
  kind: 'fm';
  f: number; // the carrier, Hz
  ratio: number; // the modulator's frequency as a multiple of the carrier's
  index: number; // how far the modulator bends the carrier's phase at the start
  indexDecay: number; // time constant over which the index falls
  indexFloor?: number; // what the index falls to; default 0
  bark?: { ratio: number; amount: number; decay: number }; // a second modulator, quick to die: a tine's bark
  decay: number;
  tremolo?: Wobble;
}
export interface GrainsLayer extends Timed {
  kind: 'grains';
  count: number;
  seconds: number; // the window the grains fall in, densest first
  f: number; // the band's centre, Hz
  q?: number; // default 0.7
}
export interface ClapsLayer extends Timed {
  kind: 'claps';
  seconds: number;
  rate: number; // claps a second at the crowd's fullest
  low?: number; // Hz, default 900
  high?: number; // Hz, default 2600
  bands?: number; // how many band buffers the claps are drawn into and filtered once each, default 3
  q?: number; // default 1.4
  swell?: number; // seconds the crowd takes to fill, default 0.35
  fade?: number; // the fall after the swell, as a share of `seconds`, default 0.35
  burst?: number; // the decay of a clap in seconds, default 0.01
}
export interface BubblesLayer extends Timed {
  kind: 'bubbles';
  count: number;
  spread: number; // seconds the onsets are scattered over, the first thickest
  f: number; // the lowest pitch, Hz
  ratio?: number; // the highest is f times this, default 4.5
  rise?: number; // each bubble's pitch rises to this multiple of itself, default 1.6
  glide?: number; // time constant of the rise, default 0.012
  decay?: number; // the middle decay of a bubble, default 0.02
}
// A patch inside a layered sound keeps a patch's one limit: its `cutoff` may be Infinity, which JSON turns into null, so
// a game that saves a layered sound as JSON gives such a patch a finite cutoff.
export interface PatchLayer extends Timed {
  kind: 'patch';
  patch: Patch;
}
export type PlainLayer =
  ToneLayer | NoiseLayer | ModesLayer | FmLayer | GrainsLayer | ClapsLayer | BubblesLayer | PatchLayer;
export interface BouncesLayer extends Timed {
  kind: 'bounces';
  layers: PlainLayer[]; // played at each hit, at their own `at` after it
  count: number;
  gap: number; // seconds from the first hit to the second
  shrink: number; // each gap is this multiple of the one before
  fade: number; // each hit is this multiple of the one before, 0 to 1
  scatter?: number; // each gap is drawn within this share either way; default 0
}
export type Layer = PlainLayer | BouncesLayer;

export interface Layered {
  layers: Layer[];
  volume: number; // 0..1 peak after normalising
  frequency?: number; // the pitch a song bends it from; required of a song's voice unless it is fixed
  jitter?: number; // 0..0.5, how far every frequency may be detuned, once a render
}

/** The longest loop a bed may be rendered as, in seconds. */
export const MAX_LOOP_SECONDS = 60;
/** The most layers a sound may have, and the most modes in a bank. */
export const MAX_LAYERS = 64;

const TAU = 2 * Math.PI;
/** How long a tone is drawn for when nothing cuts it, in decays: where it has fallen to a thousandth. */
const DECAYS = 7;
const DEFAULT_ATTACK = 0.0008;
const DEFAULT_RELEASE = 0.02;
const EMPTY = new Float32Array(0);

// ---- the check ----

const KINDS = ['tone', 'noise', 'modes', 'fm', 'grains', 'claps', 'bubbles', 'bounces', 'patch'] as const;
const WAVES = ['sine', 'square', 'saw', 'triangle'] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? String(v) : JSON.stringify(v));

// The path of a field: `layers`, then `layers[3]`, then `layers[3].q`.
function at(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path === '' ? key : `${path}.${key}`;
}

// A number within [min, max] at a path; an absent optional field is fine.
function inRange(v: unknown, where: string, min: number, max: number): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${where} must be a finite number, got ${show(v)}`;
  if (v < min || v > max) return `${where} must be from ${min} to ${max}, got ${v}`;
  return null;
}
function num(
  o: Record<string, unknown>,
  path: string,
  key: string,
  min: number,
  max: number,
  optional = false,
): string | null {
  if (o[key] === undefined && optional) return null;
  return inRange(o[key], at(path, key), min, max);
}
function whole(
  o: Record<string, unknown>,
  path: string,
  key: string,
  min: number,
  max: number,
  optional = false,
): string | null {
  const problem = num(o, path, key, min, max, optional);
  if (problem !== null) return problem;
  const v = o[key];
  if (v !== undefined && !Number.isInteger(v)) return `${at(path, key)} must be a whole number, got ${show(v)}`;
  return null;
}
function first(...problems: (string | null)[]): string | null {
  for (const p of problems) if (p !== null) return p;
  return null;
}
function wobble(o: Record<string, unknown>, path: string, key: string): string | null {
  const v = o[key];
  if (v === undefined) return null;
  const where = at(path, key);
  if (!isRecord(v)) return `${where} must be an object with a rate and a depth`;
  return first(num(v, where, 'rate', 0, 1000), num(v, where, 'depth', 0, 1));
}
// The rise, hold, fall and cut that tone, noise and fm share.
function tail(o: Record<string, unknown>, p: string, decayRequired: boolean): string | null {
  return first(
    num(o, p, 'attack', 0, MAX_SECONDS, true),
    num(o, p, 'sustain', 0, MAX_SECONDS, true),
    num(o, p, 'decay', 0.0001, MAX_SECONDS, !decayRequired),
    num(o, p, 'length', 0.001, MAX_SECONDS, true),
    num(o, p, 'release', 0, MAX_SECONDS, true),
  );
}

function checkGusts(o: Record<string, unknown>, p: string): string | null {
  const gusts = o.gusts;
  if (gusts === undefined) return null;
  const where = at(p, 'gusts');
  if (!Array.isArray(gusts) || gusts.length > 8) return `${where} must be a list of at most 8 gusts`;
  let total = 0;
  for (let i = 0; i < gusts.length; i++) {
    const g: unknown = gusts[i];
    const here = at(where, i);
    if (!isRecord(g)) return `${here} must be an object with cycles and depth`;
    const problem = first(num(g, here, 'cycles', 0.001, 1000), num(g, here, 'depth', 0, 1));
    if (problem !== null) return problem;
    total += g.depth as number;
  }
  if (total >= 1) return `${where} depths add up to ${total}, which must be under 1 or the level reaches silence`;
  return null;
}

type Check = (o: Record<string, unknown>, p: string) => string | null;
const CHECKS: Record<Exclude<(typeof KINDS)[number], 'bounces'>, Check> = {
  tone: (o, p) => {
    if (o.wave !== undefined && !WAVES.includes(o.wave as (typeof WAVES)[number]))
      return `${at(p, 'wave')} must be one of ${WAVES.join(', ')}, got ${show(o.wave)}`;
    return first(
      num(o, p, 'f', 1, 1e5),
      num(o, p, 'fEnd', 1, 1e5, true),
      num(o, p, 'glide', 0.0001, MAX_SECONDS, true),
      tail(o, p, true),
      wobble(o, p, 'vibrato'),
      wobble(o, p, 'tremolo'),
    );
  },
  noise: (o, p) => {
    if (o.filter !== undefined && !FILTERS.includes(o.filter as FilterKind))
      return `${at(p, 'filter')} must be one of ${FILTERS.join(', ')}, got ${show(o.filter)}`;
    if (o.steady !== undefined && typeof o.steady !== 'boolean')
      return `${at(p, 'steady')} must be true or false, got ${show(o.steady)}`;
    const steady = o.steady === true;
    return first(
      num(o, p, 'f', 1, 1e6),
      num(o, p, 'fEnd', 1, 1e6, true),
      num(o, p, 'q', 0.1, 100, true),
      tail(o, p, !steady),
      steady && o.length === undefined ? `${at(p, 'length')} is required of a steady noise, got undefined` : null,
      checkGusts(o, p),
      num(o, p, 'gustPower', 0, 8, true),
      num(o, p, 'gustBrighten', 0, 8, true),
    );
  },
  modes: (o, p) => {
    const modes = o.modes;
    const where = at(p, 'modes');
    if (!Array.isArray(modes) || modes.length === 0 || modes.length > MAX_LAYERS)
      return `${where} must be a list of 1 to ${MAX_LAYERS} modes`;
    for (let i = 0; i < modes.length; i++) {
      const mode: unknown = modes[i];
      const here = at(where, i);
      if (!Array.isArray(mode) || mode.length !== 3)
        return `${here} must be [frequency, decay, amplitude], got ${show(mode)}`;
      const problem = first(
        inRange(mode[0], at(here, 0), 1, 1e5),
        inRange(mode[1], at(here, 1), 0.0001, MAX_SECONDS),
        inRange(mode[2], at(here, 2), 0, 10),
      );
      if (problem !== null) return problem;
    }
    return first(
      num(o, p, 'attack', 0, MAX_SECONDS, true),
      num(o, p, 'length', 0.001, MAX_SECONDS, true),
      num(o, p, 'release', 0, MAX_SECONDS, true),
    );
  },
  fm: (o, p) => {
    let bark: string | null = null;
    if (o.bark !== undefined) {
      const where = at(p, 'bark');
      bark = isRecord(o.bark)
        ? first(
            num(o.bark, where, 'ratio', 0.01, 64),
            num(o.bark, where, 'amount', 0, 100),
            num(o.bark, where, 'decay', 0.0001, MAX_SECONDS),
          )
        : `${where} must be an object with a ratio, an amount and a decay`;
    }
    return first(
      num(o, p, 'f', 1, 1e5),
      num(o, p, 'ratio', 0.01, 64),
      num(o, p, 'index', 0, 100),
      num(o, p, 'indexDecay', 0.0001, MAX_SECONDS),
      num(o, p, 'indexFloor', 0, 100, true),
      bark,
      tail(o, p, true),
      wobble(o, p, 'tremolo'),
    );
  },
  grains: (o, p) =>
    first(
      whole(o, p, 'count', 1, 20000),
      num(o, p, 'seconds', 0.001, MAX_SECONDS),
      num(o, p, 'f', 1, 1e5),
      num(o, p, 'q', 0.1, 100, true),
    ),
  claps: (o, p) => {
    const problem = first(
      num(o, p, 'seconds', 0.01, MAX_SECONDS),
      num(o, p, 'rate', 0.1, 2000),
      num(o, p, 'low', 20, 20000, true),
      num(o, p, 'high', 20, 20000, true),
      whole(o, p, 'bands', 1, 16, true),
      num(o, p, 'q', 0.1, 100, true),
      num(o, p, 'swell', 0.001, MAX_SECONDS, true),
      num(o, p, 'fade', 0.01, 10, true),
      num(o, p, 'burst', 0.001, 0.1, true),
    );
    if (problem !== null) return problem;
    const low = typeof o.low === 'number' ? o.low : 900;
    const high = typeof o.high === 'number' ? o.high : 2600;
    if (high <= low) return `${at(p, 'high')} must be above low (${low}), got ${high}`;
    const claps = (o.rate as number) * (o.seconds as number);
    if (claps > 20000) return `${at(p, 'rate')} times seconds is ${claps} claps, more than 20000`;
    return null;
  },
  bubbles: (o, p) =>
    first(
      whole(o, p, 'count', 1, 500),
      num(o, p, 'spread', 0.0001, MAX_SECONDS),
      num(o, p, 'f', 1, 1e5),
      num(o, p, 'ratio', 1, 16, true),
      num(o, p, 'rise', 0.25, 4, true),
      num(o, p, 'glide', 0.0001, MAX_SECONDS, true),
      num(o, p, 'decay', 0.001, 1, true),
    ),
  patch: (o, p) => {
    const problem = checkPatch(o.patch);
    return problem === null ? null : `${at(p, 'patch')}: ${problem}`;
  },
};

function checkLayer(l: unknown, p: string, inside: boolean): string | null {
  if (!isRecord(l)) return `${p} must be an object`;
  const kind = l.kind as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) return `${at(p, 'kind')} must be one of ${KINDS.join(', ')}, got ${show(l.kind)}`;
  if (kind === 'bounces' && inside) return `${at(p, 'kind')} may not be bounces inside bounces`;
  const head = first(num(l, p, 'at', 0, MAX_SECONDS), num(l, p, 'gain', 0, 10));
  if (head !== null) return head;
  let problem: string | null;
  if (kind === 'bounces') {
    const inner = l.layers;
    if (!Array.isArray(inner) || inner.length === 0 || inner.length > 16)
      return `${at(p, 'layers')} must be a list of 1 to 16 layers`;
    for (let i = 0; i < inner.length; i++) {
      problem = checkLayer(inner[i], at(at(p, 'layers'), i), true);
      if (problem !== null) return problem;
    }
    problem = first(
      whole(l, p, 'count', 1, 64),
      num(l, p, 'gap', 0.001, MAX_SECONDS),
      num(l, p, 'shrink', 0.01, 2),
      num(l, p, 'fade', 0, 1),
      num(l, p, 'scatter', 0, 0.9, true),
    );
  } else problem = CHECKS[kind](l, p);
  if (problem !== null) return problem;
  const end = layerEnd(l as unknown as Layer);
  if (end > MAX_SECONDS) return `${p} lasts until ${Number(end.toFixed(3))} s, more than ${MAX_SECONDS}`;
  return null;
}

/** True when the value is a layered sound as far as its shape goes (it has a list of layers), and not a patch. */
export function isLayered(sound: unknown): sound is Layered {
  return isRecord(sound) && Array.isArray(sound.layers);
}

// A problem with the layered sound, named by the path of its field, or null when it is sound. The sample rate is not
// known here, so a pitch above the Nyquist is renderLayered's to refuse.
export function checkLayered(sound: unknown): string | null {
  if (!isRecord(sound)) return 'layered sound must be an object';
  const layers = sound.layers;
  if (!Array.isArray(layers) || layers.length === 0 || layers.length > MAX_LAYERS)
    return `layers must be a list with at least one layer and at most ${MAX_LAYERS}`;
  const head = first(
    num(sound, '', 'volume', 0, 1),
    num(sound, '', 'frequency', 0.01, 1e5, true),
    num(sound, '', 'jitter', 0, 0.5, true),
  );
  if (head !== null) return head;
  for (let i = 0; i < layers.length; i++) {
    const problem = checkLayer(layers[i], at('layers', i), false);
    if (problem !== null) return problem;
  }
  return null;
}

// ---- how long ----

// The seconds a tone-shaped layer lasts: its cut-off if it has one, or else where its fall is inaudible.
const shaped = (attack: number, sustain: number, decay: number, length: number | undefined): number =>
  length ?? attack + sustain + DECAYS * decay;

// How long a layer lasts from its own start, in seconds.
function span(l: Layer): number {
  switch (l.kind) {
    case 'tone':
    case 'fm':
      return shaped(l.attack ?? DEFAULT_ATTACK, l.sustain ?? 0, l.decay, l.length);
    case 'noise':
      if (l.steady === true) return l.length ?? 0;
      return shaped(l.attack ?? DEFAULT_ATTACK, l.sustain ?? 0, l.decay ?? 0, l.length);
    case 'modes': {
      let slowest = 0;
      for (const mode of l.modes) slowest = Math.max(slowest, mode[1]);
      return shaped(l.attack ?? DEFAULT_ATTACK, 0, slowest, l.length);
    }
    case 'grains':
      return l.seconds + 0.05;
    case 'claps':
      return l.seconds + 5.6 * (l.burst ?? 0.01);
    case 'bubbles':
      return l.spread + 8 * (l.decay ?? 0.02);
    case 'patch':
      return duration(l.patch);
    case 'bounces': {
      let inner = 0;
      for (const layer of l.layers) inner = Math.max(inner, layerEnd(layer));
      let gaps = 0;
      let gap = l.gap;
      for (let k = 1; k < l.count; k++) {
        gaps += gap * (1 + (l.scatter ?? 0));
        gap *= l.shrink;
      }
      return inner + gaps;
    }
  }
}

function layerEnd(l: Layer): number {
  return l.at + span(l);
}

/** How long the sound lasts, in seconds: the latest end of any layer. */
export function layeredSeconds(sound: Layered): number {
  let end = 0;
  for (const layer of sound.layers) end = Math.max(end, layerEnd(layer));
  return end;
}

// ---- the render ----

interface Context {
  rate: number;
  random: () => number;
  /** The detune every frequency is multiplied by, drawn once. */
  detune: number;
  /** The loop's length in samples, or 0 when the sound is not a loop: a loop's tails come round to its start. */
  loop: number;
}

// Adds a layer's buffer into the mix from a sample, scaled. Anything past the end of the mix is dropped, or in a loop
// comes round to the start.
function mix(out: Float32Array, buffer: Float32Array, start: number, gain: number, wrap: boolean): void {
  if (!wrap) {
    const n = Math.min(buffer.length, out.length - start);
    for (let i = 0; i < n; i++) out[start + i] += buffer[i] * gain;
    return;
  }
  let k = start % out.length;
  for (let i = 0; i < buffer.length; i++) {
    out[k] += buffer[i] * gain;
    if (++k === out.length) k = 0;
  }
}

// The envelope of a tone-shaped layer over n samples: a rise, a hold, an exponential fall (carried by a running
// product, not an exp a sample), a tremolo, and a fade to nothing over the last `release` seconds when it is cut.
function envelope(c: Context, n: number, e: Tail & { decay: number; tremolo?: Wobble }): Float32Array {
  const env = new Float32Array(n);
  const rate = c.rate;
  const rise = (e.attack ?? DEFAULT_ATTACK) * rate;
  const start = ((e.attack ?? DEFAULT_ATTACK) + (e.sustain ?? 0)) * rate;
  const step = Math.exp(-1 / (e.decay * rate));
  let level = 1;
  for (let i = 0; i < n; i++) {
    if (i < start) env[i] = i < rise ? i / rise : 1;
    else {
      if (i - start < 1) level = Math.exp(-(i - start) / (e.decay * rate));
      env[i] = level;
      level *= step;
    }
  }
  if (e.length !== undefined) {
    const release = (e.release ?? DEFAULT_RELEASE) * rate;
    const end = e.length * rate;
    if (release > 0)
      for (let i = Math.floor(Math.max(0, end - release)); i < n; i++)
        env[i] *= Math.max(0, Math.min(1, (end - i) / release));
  }
  if (e.tremolo) {
    const w = (TAU * e.tremolo.rate) / rate;
    for (let i = 0; i < n; i++) env[i] *= 1 + e.tremolo.depth * Math.sin(w * i);
  }
  return env;
}

// How many samples a tone-shaped layer is drawn for: to its cut, or to where it is inaudible, whichever comes first.
function samplesFor(c: Context, attack: number, sustain: number, decay: number, length: number | undefined): number {
  const natural = attack + sustain + DECAYS * decay;
  return Math.max(1, Math.ceil(Math.min(natural, length ?? natural) * c.rate));
}

function wave(kind: NonNullable<ToneLayer['wave']>, phase: number): number {
  switch (kind) {
    case 'sine':
      return Math.sin(TAU * phase);
    case 'square':
      return phase - Math.floor(phase) < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * (phase - Math.floor(phase)) - 1;
    case 'triangle':
      return 4 * Math.abs(phase - Math.floor(phase) - 0.5) - 1;
  }
}

// A tone: a wave at f gliding to fEnd, under the envelope, with a vibrato that fades as the tone does. The glide and
// the fade run as products, so a sample costs a sine and a few multiplies and not two exps.
function toneBuffer(c: Context, o: ToneLayer, path: string): Float32Array {
  const nyquist = c.rate / 2;
  const f = o.f * c.detune;
  const fEnd = (o.fEnd ?? o.f) * c.detune;
  if (f >= nyquist || fEnd >= nyquist)
    throw new Error(`${path}.f: ${Math.max(f, fEnd)} Hz is at or past the Nyquist of ${nyquist} Hz at ${c.rate} Hz`);
  const n = samplesFor(c, o.attack ?? DEFAULT_ATTACK, o.sustain ?? 0, o.decay, o.length);
  const env = envelope(c, n, o);
  const out = new Float32Array(n);
  const glideStep = Math.exp(-1 / ((o.glide ?? o.decay) * c.rate));
  const kind = o.wave ?? 'sine';
  const vib = o.vibrato;
  const vibW = vib ? (TAU * vib.rate) / c.rate : 0;
  const vibStep = Math.exp(-1 / (2 * o.decay * c.rate));
  const sine = kind === 'sine';
  const step = 1 / c.rate;
  let glide = 1;
  let vibLevel = 1;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    let hz = fEnd + (f - fEnd) * glide;
    glide *= glideStep;
    if (vib) {
      hz *= 1 + vib.depth * Math.sin(vibW * i) * vibLevel;
      vibLevel *= vibStep;
    }
    phase += Math.min(hz, nyquist) * step;
    out[i] = (sine ? Math.sin(TAU * phase) : wave(kind, phase)) * env[i];
  }
  return out;
}

// A bank of modes: each a sine that rings and falls on its own time, the frequencies detuned together. A mode at or
// past the Nyquist is not drawn, since a game's modes are fixed numbers and a lower sample rate must not refuse them.
function modesInto(out: Float32Array, c: Context, o: ModesLayer, start: number, gain: number): void {
  const nyquist = c.rate / 2;
  const attack = o.attack ?? DEFAULT_ATTACK;
  for (const [frequency, decay, amplitude] of o.modes) {
    const f = frequency * c.detune;
    if (f >= nyquist) continue;
    const n = samplesFor(c, attack, 0, decay, o.length);
    const env = envelope(c, n, { attack, decay, length: o.length, release: o.release });
    const w = (TAU * f) / c.rate;
    const buffer = new Float32Array(n);
    for (let i = 0; i < n; i++) buffer[i] = Math.sin(w * i) * env[i];
    mix(out, buffer, start, gain * amplitude, c.loop > 0);
  }
}

// Frequency modulation: a carrier whose phase is bent by a modulator at a multiple of its pitch, the bend falling as
// the note rings (an electric piano's bite, a bell's shimmer). `bark` is a second, quicker modulator for the strike.
function fmBuffer(c: Context, o: FmLayer, path: string): Float32Array {
  const nyquist = c.rate / 2;
  const f = o.f * c.detune;
  if (f >= nyquist) throw new Error(`${path}.f: ${f} Hz is at or past the Nyquist of ${nyquist} Hz at ${c.rate} Hz`);
  const n = samplesFor(c, o.attack ?? DEFAULT_ATTACK, o.sustain ?? 0, o.decay, o.length);
  const env = envelope(c, n, o);
  const out = new Float32Array(n);
  const w = (TAU * f) / c.rate;
  const indexStep = Math.exp(-1 / (o.indexDecay * c.rate));
  const floor = o.indexFloor ?? 0;
  const bark = o.bark;
  const barkStep = bark ? Math.exp(-1 / (bark.decay * c.rate)) : 1;
  let index = o.index;
  let barkLevel = bark ? bark.amount : 0;
  for (let i = 0; i < n; i++) {
    let angle = w * i + (floor + index) * Math.sin(w * o.ratio * i);
    // A bark has fallen to nothing audible within a few of its decays, and then costs no sine.
    if (barkLevel > 1e-5) {
      angle += barkLevel * Math.sin(w * (bark?.ratio ?? 0) * i);
      barkLevel *= barkStep;
    }
    out[i] = Math.sin(angle) * env[i];
    index *= indexStep;
  }
  return out;
}

// The level of the gusts: 1 plus each gust's sine. Worked out every BLOCK samples and not every sample, since a gust
// is slow, and the filter's corner is held for the same blocks. `power` is applied to the table and not to the samples:
// a power is dear, and between two blocks of 32 samples the level is a straight line anyway.
const BLOCK = 32;
/** How many samples from the end of a bed are run through its filter first, which is long past where it has settled. */
const WARM = 16384;
function gustTable(c: Context, gusts: Gust[], n: number, power = 1): Float32Array {
  const phases = gusts.map(() => TAU * c.random());
  const table = new Float32Array(Math.ceil(n / BLOCK) + 2);
  for (let j = 0; j < table.length; j++) {
    let g = 1;
    for (let k = 0; k < gusts.length; k++)
      g += gusts[k].depth * Math.sin(phases[k] + (TAU * gusts[k].cycles * j * BLOCK) / n);
    table[j] = power === 1 ? g : Math.max(0, g) ** power;
  }
  return table;
}
const gustAt = (table: Float32Array, i: number): number => {
  const j = Math.floor(i / BLOCK);
  return table[j] + (table[j + 1] - table[j]) * ((i - j * BLOCK) / BLOCK);
};

// Noise through the biquad: a click, a breath, a bed. A steady one holds its level for `length` and is swelled by the
// gusts; otherwise it rises and falls like a tone.
function noiseBuffer(c: Context, o: NoiseLayer): Float32Array {
  const steady = o.steady === true;
  // In a loop a bed spans the whole of it, so that its swells divide it and its end meets its start.
  const bed = steady && c.loop > 0;
  const attack = o.attack ?? DEFAULT_ATTACK;
  const n = bed
    ? c.loop
    : steady
      ? Math.max(1, Math.ceil((o.length ?? 0) * c.rate))
      : samplesFor(c, attack, o.sustain ?? 0, o.decay ?? 0, o.length);
  // a bed in a loop is level all along, so it has no envelope to multiply by
  let env: Float32Array;
  if (bed) env = EMPTY;
  else if (steady) env = envelope(c, n, { attack: 0, decay: 1e9, length: o.length, release: o.release });
  else env = envelope(c, n, { ...o, decay: o.decay ?? 0 });
  // The gusts' phases are drawn once, and the one table gives both the level and the corner.
  const raw = o.gusts !== undefined && o.gusts.length > 0 ? gustTable(c, o.gusts, n) : null;
  const power = o.gustPower ?? 1;
  const brighten = o.gustBrighten ?? 0;
  const levels = raw && power !== 0 ? (power === 1 ? raw : raw.map((g) => Math.max(0, g) ** power)) : null;
  const x = new Float32Array(n);
  const random = c.random;
  for (let start = 0; start < n; start += BLOCK) {
    const end = Math.min(n, start + BLOCK);
    if (levels) {
      const j = start / BLOCK;
      const level = Math.max(0, levels[j]);
      const slope = (Math.max(0, levels[j + 1]) - level) / BLOCK;
      for (let i = start; i < end; i++) x[i] = (2 * random() - 1) * (bed ? 1 : env[i]) * (level + slope * (i - start));
    } else for (let i = start; i < end; i++) x[i] = (2 * random() - 1) * (bed ? 1 : env[i]);
  }
  const swept = brighten !== 0 && raw !== null;
  return biquad(x, c.rate, {
    type: o.filter ?? 'lowpass',
    f: o.f,
    fEnd: o.fEnd,
    q: o.q,
    // the end of the buffer is run through first, so that the start is where the end leaves the filter
    warm: bed ? Math.min(n, WARM) : 0,
    // a corner that is swept and swelled by the gusts is worked out for each block; one that is only swept is the filter's
    // own sweep, and one that does not move is worked out once
    corner: swept
      ? (i) => o.f * ((o.fEnd ?? o.f) / o.f) ** (i / n) * 2 ** (brighten * (gustAt(raw, i) - 1))
      : undefined,
  });
}

// Tiny clicks scattered over a window, densest first, through a band: sand, gravel. Every onset is drawn inside the
// window by inverting an exponential cut off at its end, so the count is the count.
function grainsBuffer(c: Context, o: GrainsLayer): Float32Array {
  const n = Math.ceil((o.seconds + 0.05) * c.rate);
  const x = new Float32Array(n);
  const clickLength = Math.max(2, Math.ceil(0.0005 * c.rate));
  const click = new Float32Array(clickLength);
  for (let j = 0; j < clickLength; j++) click[j] = Math.exp(-j / (0.0001 * c.rate));
  const scale = 0.3 * o.seconds;
  const reach = 1 - Math.exp(-1 / 0.3);
  for (let g = 0; g < o.count; g++) {
    const t = -Math.log(1 - c.random() * reach) * scale;
    const i = Math.floor(t * c.rate);
    const amp = (2 * c.random() - 1) * Math.exp(-t / (o.seconds * 0.5));
    for (let j = 0; j < clickLength && i + j < n; j++) x[i + j] += amp * click[j] * (2 * c.random() - 1);
  }
  return biquad(x, c.rate, { type: 'bandpass', f: o.f, q: o.q ?? 0.7 });
}

// A crowd clapping: bursts at a rate that swells and then dies, each drawn into one of a few band buffers, and each
// band filtered once. Filtering a burst at a time costs a filter run per clap and makes applause the dearest sound
// there is; filtering a band costs one run in all, whatever the crowd's size.
function clapsBuffer(c: Context, o: ClapsLayer): Float32Array {
  const bands = o.bands ?? 3;
  const low = o.low ?? 900;
  const high = o.high ?? 2600;
  const swell = o.swell ?? 0.35;
  const fade = o.fade ?? 0.35;
  const burst = o.burst ?? 0.01;
  const n = Math.ceil((o.seconds + 5.6 * burst) * c.rate);
  const table = new Float32Array(4096);
  for (let i = 0; i < table.length; i++) table[i] = 2 * c.random() - 1;
  const buffers = Array.from({ length: bands }, () => new Float32Array(n));
  const hold = 1.4 * swell;
  const clap = (t: number, shape: number): void => {
    const band = buffers[Math.floor(c.random() * bands)];
    const decay = burst * (0.6 + 0.8 * c.random());
    const amp = shape * (0.4 + 0.6 * c.random());
    const offset = Math.floor(c.random() * table.length);
    const start = Math.floor(t * c.rate);
    const length = Math.min(n - start, Math.ceil(4 * decay * c.rate));
    const step = Math.exp(-1 / (decay * c.rate));
    let level = amp;
    for (let j = 0; j < length; j++) {
      band[start + j] += table[(offset + j) & 4095] * level;
      level *= step;
    }
  };
  // How full the crowd is at a time: quick to swell and slow to die.
  const fullness = (t: number): number =>
    Math.min(1, t / swell) * Math.exp(-Math.max(0, t - hold) / (o.seconds * fade));
  let claps = 0;
  for (let t = 0; t < o.seconds;) {
    t += -Math.log(1 - c.random() * 0.999) / (o.rate * Math.max(fullness(t), 0.05));
    if (t >= o.seconds) break;
    clap(t, Math.max(fullness(t), 0.05));
    claps++;
  }
  // A crowd small or short enough to have drawn no clap at all would be silence, which is not what was asked for: one
  // clap, in the middle of the window.
  if (claps === 0) clap(o.seconds / 2, 1);
  const out = new Float32Array(n);
  for (let b = 0; b < bands; b++) {
    const centre = low * (high / low) ** ((b + 0.5) / bands);
    biquad(buffers[b], c.rate, { type: 'bandpass', f: centre, q: o.q ?? 1.4 });
    for (let i = 0; i < n; i++) out[i] += buffers[b][i];
  }
  return out;
}

// Bubbles, as a bubble sounds when it rises in water: a little sine whose pitch climbs as it nears the surface
// (Minnaert's), each at its own pitch, size and moment.
function bubblesInto(out: Float32Array, c: Context, o: BubblesLayer, start: number, gain: number, path: string): void {
  const ratio = o.ratio ?? 4.5;
  const rise = o.rise ?? 1.6;
  const base = o.decay ?? 0.02;
  const reach = 1 - Math.exp(-1 / 0.3);
  // the highest pitch a bubble may reach, which the draw is held under so that no bubble is a Nyquist error
  const ceiling = (0.45 * c.rate) / (Math.max(1, rise) * c.detune);
  for (let b = 0; b < o.count; b++) {
    const t = -Math.log(1 - c.random() * reach) * 0.3 * o.spread;
    const f = Math.min(o.f * ratio ** c.random(), ceiling);
    const decay = base * (0.4 + 1.2 * c.random());
    const level = (0.4 + 0.6 * c.random()) * Math.exp(-t / (o.spread * 0.8));
    const bubble: ToneLayer = {
      kind: 'tone',
      at: 0,
      gain: 1,
      f,
      fEnd: f * rise,
      glide: o.glide ?? 0.012,
      decay,
      length: 4 * decay,
      release: decay,
    };
    mix(out, toneBuffer(c, bubble, path), start + Math.round(t * c.rate), gain * level, c.loop > 0);
  }
}

// Draws one layer into the mix. `offset` is the second the enclosing hit starts at and `scale` its loudness, which a
// bounces layer passes to the layers it repeats; at the top level they are 0 and 1.
function layerInto(out: Float32Array, c: Context, layer: Layer, offset: number, scale: number, path: string): void {
  const start = Math.round((offset + layer.at) * c.rate);
  const gain = layer.gain * scale;
  switch (layer.kind) {
    case 'tone':
      mix(out, toneBuffer(c, layer, path), start, gain, c.loop > 0);
      return;
    case 'noise':
      mix(out, noiseBuffer(c, layer), start, gain, c.loop > 0);
      return;
    case 'modes':
      modesInto(out, c, layer, start, gain);
      return;
    case 'fm':
      mix(out, fmBuffer(c, layer, path), start, gain, c.loop > 0);
      return;
    case 'grains':
      mix(out, grainsBuffer(c, layer), start, gain, c.loop > 0);
      return;
    case 'claps':
      mix(out, clapsBuffer(c, layer), start, gain, c.loop > 0);
      return;
    case 'bubbles':
      bubblesInto(out, c, layer, start, gain, path);
      return;
    case 'patch': {
      let samples: Float32Array;
      try {
        samples = render(layer.patch, c.rate, c.random);
      } catch (error) {
        throw new Error(`${path}.patch: ${error instanceof Error ? error.message : String(error)}`);
      }
      mix(out, samples, start, gain, c.loop > 0);
      return;
    }
    case 'bounces': {
      let t = 0;
      let gap = layer.gap;
      let level = 1;
      for (let k = 0; k < layer.count; k++) {
        for (let i = 0; i < layer.layers.length; i++)
          layerInto(out, c, layer.layers[i], offset + layer.at + t, gain * level, `${path}.layers[${i}]`);
        t += gap * (layer.scatter ? 1 + layer.scatter * (2 * c.random() - 1) : 1);
        gap *= layer.shrink;
        level *= layer.fade;
      }
    }
  }
}

/**
 * A soft clip: tanh's curve by a rational that is within 0.025 of it and a quarter of its cost, held at 1 past 3, where
 * the two meet. A tanh a sample is most of what a long quiet bed costs to render, and a clip that is a few hundredths off
 * a tanh is not heard: it is there so that a crowd of layers bends and does not crack.
 */
export function softClip(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const square = x * x;
  return (x * (27 + square)) / (27 + 9 * square);
}

// Draws every layer into the mix, then soft-clips it. A problem in a layer is named by its path.
function drawLayers(who: string, sound: Layered, out: Float32Array, c: Context): void {
  sound.layers.forEach((layer, i) => {
    try {
      layerInto(out, c, layer, 0, 1, `layers[${i}]`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${who}: ${message.startsWith('layers[') ? message : `layers[${i}]: ${message}`}`);
    }
  });
  for (let i = 0; i < out.length; i++) out[i] = softClip(out[i]);
}

// The detune of the whole, drawn once, so the whole sound is higher or lower and no layer is out of tune with another.
// A draw of 0.5 is no change.
function detuneOf(sound: Layered, random: () => number): number {
  const jitter = sound.jitter ?? 0;
  return jitter > 0 ? 1 + jitter * (2 * random() - 1) : 1;
}

// Samples for the layered sound at the sample rate: exactly Math.round(layeredSeconds * sampleRate) of them, the last
// exactly 0 and the peak `volume`. `random` is called as it is needed and never kept.
export function renderLayered(sound: Layered, sampleRate: number, random: () => number): Float32Array {
  const problem = checkLayered(sound);
  if (problem !== null) throw new Error(`renderLayered: ${problem}`);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new Error(`renderLayered: sampleRate must be above 0, got ${sampleRate}`);
  const c: Context = { rate: sampleRate, random, detune: detuneOf(sound, random), loop: 0 };
  const out = new Float32Array(Math.max(1, Math.round(layeredSeconds(sound) * sampleRate)));
  drawLayers('renderLayered', sound, out, c);
  out[out.length - 1] = 0;
  return normalise(out, sound.volume);
}

// What a loop needs that a sound does not: a layer that starts inside it, and swells that come round a whole number of
// times, since a swell that does not would meet itself with a step. Named by path, like the rest.
function loopProblem(layer: Layer, path: string, seconds: number): string | null {
  if (layer.at >= seconds) return `${path}.at must be before the end of the loop (${seconds} s), got ${layer.at}`;
  if (layer.kind === 'noise' && layer.gusts !== undefined) {
    for (let k = 0; k < layer.gusts.length; k++)
      if (!Number.isInteger(layer.gusts[k].cycles))
        return `${path}.gusts[${k}].cycles must be a whole number in a loop, so that the swell divides it, got ${layer.gusts[k].cycles}`;
  }
  if (layer.kind === 'bounces') {
    for (let k = 0; k < layer.layers.length; k++) {
      const problem = loopProblem(layer.layers[k], `${path}.layers[${k}]`, seconds);
      if (problem !== null) return problem;
    }
  }
  return null;
}

// A loop: `seconds` of the sound, exactly Math.round(seconds * sampleRate) samples, that comes round to its start with
// no step. A tail that runs past the end is wrapped over the start, a steady noise is a bed that spans the whole loop
// (ignoring its `at` and `length`) and starts in the state its end leaves its filter in, and its swells are checked to
// divide the loop. It is not ended on 0, being a loop and not a sound; the peak is `volume`.
export function renderLoop(sound: Layered, seconds: number, sampleRate: number, random: () => number): Float32Array {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_LOOP_SECONDS)
    throw new Error(`renderLoop: seconds must be from above 0 to ${MAX_LOOP_SECONDS}, got ${seconds}`);
  const problem = checkLayered(sound);
  if (problem !== null) throw new Error(`renderLoop: ${problem}`);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new Error(`renderLoop: sampleRate must be above 0, got ${sampleRate}`);
  for (let i = 0; i < sound.layers.length; i++) {
    const trouble = loopProblem(sound.layers[i], `layers[${i}]`, seconds);
    if (trouble !== null) throw new Error(`renderLoop: ${trouble}`);
  }
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const c: Context = { rate: sampleRate, random, detune: detuneOf(sound, random), loop: length };
  const out = new Float32Array(length);
  drawLayers('renderLoop', sound, out, c);
  return normalise(out, sound.volume);
}
