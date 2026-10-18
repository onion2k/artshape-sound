// The synth: a patch in, samples out, in plain TypeScript with no Web Audio, so that a sound can be rendered, hashed and
// read back under node and is the same bits on every run. Without it a sound would exist only inside a browser's audio
// graph, out of reach of a test. Chance enters only as the `random` argument, drawn in a fixed order: the jitter once
// at the start, then one draw per sample for each of noise's two uses.

import { checkPatch, type Patch } from './patch';
import { normalise } from './loudness';

// How long the sound lasts, in seconds: the three stages of the envelope added together.
export function duration(patch: Patch): number {
  return patch.attack + patch.sustain + patch.release;
}

// A stage of the envelope sits in one part of the line below. With `repeat` the whole envelope is squeezed into each
// period, so every retrigger is a complete pulse that ends at 0 and the next begins at 0: no click between them.
function envelope(patch: Patch, t: number): number {
  const { attack, sustain, release, punch } = patch;
  if (t < attack) return t / attack;
  const s = t - attack;
  if (s < sustain) return 1 + 2 * punch * (1 - s / sustain);
  if (release === 0) return 0;
  return Math.max(0, 1 - (s - sustain) / release);
}

// The wave at a phase in [0, 1). Noise is held between phase wraps by the caller, so it has a pitch of a sort.
function shape(wave: Patch['wave'], phase: number): number {
  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * phase);
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * phase - 1;
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'noise':
      return 0;
  }
}

// Samples for the patch at the sample rate: exactly Math.round(duration * sampleRate) of them, rounded to the nearest
// so that 44100 and 48000 each hold the length to within half a sample, and the last one is exactly 0. The peak is
// patch.volume. `random` is called each time it is needed and never kept; with none given the fallback is the global
// source, read here and nowhere else in src/, so that a game that passes its own seeded one gets the same sound every
// run.
export function render(patch: Patch, sampleRate: number, random?: () => number): Float32Array {
  const problem = checkPatch(patch);
  if (problem !== null) throw new Error(`render: ${problem}`);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new Error(`render: sampleRate must be above 0, got ${sampleRate}`);
  const nyquist = sampleRate / 2;
  if (patch.frequency >= nyquist) {
    throw new Error(
      `render: frequency ${patch.frequency} Hz is at or past the Nyquist of ${nyquist} Hz at ${sampleRate} Hz`,
    );
  }
  const draw = random ?? Math.random;

  const total = duration(patch);
  const length = Math.round(total * sampleRate);
  const out = new Float32Array(length);

  // Jitter is drawn once, so a whole sound is higher or lower and not warbling. A draw of 0.5 is no change.
  const start = patch.jitter > 0 ? patch.frequency * (1 + patch.jitter * (2 * draw() - 1)) : patch.frequency;
  const period = patch.repeat > 0 ? 1 / patch.repeat : 0;
  const filtered = patch.cutoff !== Infinity;

  let phase = 0;
  let held = patch.wave === 'noise' ? 2 * draw() - 1 : 0;
  let lowA = 0;
  let lowB = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pitch and envelope both restart with each repeat; the pitch in real seconds, the envelope squeezed to fit.
    const local = period > 0 ? ((t * patch.repeat) % 1) * period : t;
    const shaped = period > 0 ? (local / period) * total : t;

    const vibrato = patch.vibratoDepth * Math.sin(2 * Math.PI * patch.vibratoRate * t);
    const hz = Math.min(nyquist, Math.max(0, start + patch.slide * local + vibrato));
    phase += hz / sampleRate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      if (patch.wave === 'noise') held = 2 * draw() - 1;
    }
    let v = patch.wave === 'noise' ? held : shape(patch.wave, phase);
    if (patch.noise > 0) v = v * (1 - patch.noise) + patch.noise * (2 * draw() - 1);

    if (filtered) {
      const cut = Math.min(nyquist * 0.99, Math.max(1, patch.cutoff + patch.cutoffSlide * t));
      const a = 1 - Math.exp((-2 * Math.PI * cut) / sampleRate);
      // Two one-pole stages in a row, for 12 dB an octave and not 6.
      lowA += a * (v - lowA);
      lowB += a * (lowA - lowB);
      v = lowB;
    }
    out[i] = v * envelope(patch, shaped);
  }
  if (length > 0) out[length - 1] = 0;
  return normalise(out, patch.volume);
}
