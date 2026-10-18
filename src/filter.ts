// The biquad: a lowpass, highpass or bandpass over a buffer, in place, with the corner swept along it. It is the filter
// the layered sounds are made with (noise under a falling corner is most of a splash and a swing), kept apart from them
// so that it can be tested alone. Pure arithmetic over a Float32Array; no Web Audio, no chance. The coefficients are
// the RBJ cookbook's, which are stable for any corner below the Nyquist and any Q above 0, and the corner is clamped
// into that range, so no input makes NaN.

export type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

export const FILTERS: readonly FilterKind[] = ['lowpass', 'highpass', 'bandpass'];

export interface FilterOptions {
  type: FilterKind;
  /** The corner, or the centre of a band, in Hz. */
  f: number;
  /** Where the corner has swept to by the end of the buffer, exponentially; default `f`, no sweep. */
  fEnd?: number;
  /** Resonance, above 0; 0.707 is flat. Default 0.707. */
  q?: number;
  /** The corner at sample `i`, in place of the sweep from `f` to `fEnd`: for a corner that follows something else. */
  corner?: (i: number) => number;
  /** For a loop: this many samples from the end are run through first, their output thrown away, so that the buffer
   * starts in the state its end leaves and the seam has no step in it. */
  warm?: number;
}

/** The lowest corner, in Hz, and the highest as a share of the sample rate, between which every corner is clamped. */
export const MIN_CORNER = 20;
export const MAX_CORNER_SHARE = 0.45;

/** How many samples the coefficients hold for before they are worked out again. */
const BLOCK = 32;

// The five coefficients [b0, b1, b2, a1, a2], already divided by a0. The constant-peak-gain bandpass, so that a band
// of a high Q is not quieter than a wide one.
function coefficients(
  type: FilterKind,
  f: number,
  q: number,
  sampleRate: number,
): [number, number, number, number, number] {
  const w = (2 * Math.PI * Math.min(Math.max(f, MIN_CORNER), sampleRate * MAX_CORNER_SHARE)) / sampleRate;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number, b1: number, b2: number;
  switch (type) {
    case 'lowpass':
      [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
      break;
    case 'highpass':
      [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
      break;
    case 'bandpass':
      [b0, b1, b2] = [alpha, 0, -alpha];
      break;
  }
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * c) / a0, (1 - alpha) / a0];
}

// Filters `x` in place and gives it back. The corner is held for BLOCK samples at a time, which is finer than the ear
// follows a sweep and saves a sine and a cosine a sample.
export function biquad(x: Float32Array, sampleRate: number, o: FilterOptions): Float32Array {
  const n = x.length;
  if (n === 0) return x;
  const q = o.q ?? 0.7071;
  const f0 = o.f;
  const ratio = (o.fEnd ?? o.f) / o.f;
  const at = o.corner ?? ((i: number) => f0 * ratio ** (i / n));
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let k = coefficients(o.type, at(0), q, sampleRate);

  const run = (from: number, to: number, write: boolean): void => {
    for (let i = from; i < to; i++) {
      if (i % BLOCK === 0) k = coefficients(o.type, at(i), q, sampleRate);
      const v = x[i];
      const y = k[0] * v + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2;
      x2 = x1;
      x1 = v;
      y2 = y1;
      y1 = y;
      if (write) x[i] = y;
    }
  };
  const warm = Math.min(n, Math.max(0, Math.floor(o.warm ?? 0)));
  if (warm > 0) run(n - warm, n, false);
  run(0, n, true);
  return x;
}
