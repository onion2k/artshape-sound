// Small things the tests share. A seeded source of chance lives here so that a test never reaches for the global one,
// and no test can pass or fail by the luck of a draw.

// mulberry32: four lines, good enough to spread a test's draws, and the same on every machine.
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Upward zero crossings per second over the half-open sample range [from, to): a sine's frequency read back.
export function crossingsPerSecond(s: Float32Array, sampleRate: number, from = 0, to = s.length): number {
  let n = 0;
  for (let i = Math.max(from, 1); i < to; i++) if (s[i - 1] < 0 && s[i] >= 0) n++;
  return n / ((to - from) / sampleRate);
}

// The rms of one signal taken from another, which is how far apart two renders are.
export function rmsOfDifference(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

// The magnitude of one frequency in the samples over [from, to), by Goertzel's sum: a DFT bin at any frequency, so a
// test reads a sound's spectrum without a transform. Scaled so that a sine of amplitude A at `hz` reads about A.
export function magnitudeAt(s: Float32Array, sampleRate: number, hz: number, from = 0, to = s.length): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const k = 2 * Math.cos(w);
  let a = 0;
  let b = 0;
  for (let i = from; i < to; i++) {
    const c = s[i] + k * a - b;
    b = a;
    a = c;
  }
  const re = a - b * Math.cos(w);
  const im = b * Math.sin(w);
  return (2 * Math.sqrt(re * re + im * im)) / (to - from);
}

// The mean energy per bin of the samples in a band, from the squares of Goertzel bins every `step` Hz: enough to say
// that a lowpass has less above its corner than below, whatever the widths of the two bands.
export function bandEnergy(s: Float32Array, sampleRate: number, lo: number, hi: number, step = 100): number {
  let sum = 0;
  let bins = 0;
  for (let hz = lo; hz < hi; hz += step) {
    sum += magnitudeAt(s, sampleRate, hz) ** 2;
    bins++;
  }
  return sum / Math.max(1, bins);
}

// The first sample from `from` at or above a fraction of the buffer's peak: where a click or a note starts.
export function onsetsOf(s: Float32Array, sampleRate: number, threshold: number, quiet = 0.01): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < s.length; i++) {
    if (Math.abs(s[i]) >= threshold) {
      if (i / sampleRate - last > quiet) out.push(i / sampleRate);
      last = i / sampleRate;
    }
  }
  return out;
}
