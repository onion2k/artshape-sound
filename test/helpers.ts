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
