// Loudness arithmetic over plain sample arrays: the peak, the rms, and a scaling to a target peak. Without it every
// patch would come out at whatever level its wave, punch and filter happened to leave it, and a coin would be far
// louder than a click. Pure functions; nothing here touches Web Audio.

// The largest magnitude in the samples, 0 for silence or nothing.
export function peak(s: Float32Array): number {
  let top = 0;
  for (let i = 0; i < s.length; i++) {
    const v = Math.abs(s[i]);
    if (v > top) top = v;
  }
  return top;
}

// The root of the mean square, 0 for nothing so that it is never NaN.
export function rms(s: Float32Array): number {
  if (s.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / s.length);
}

// A copy of the samples scaled so that their peak is targetPeak. Silence has no peak to scale, so it comes back as
// silence and not as NaN. The input is left alone, so that a caller may keep the unscaled render.
export function normalise(s: Float32Array, targetPeak: number): Float32Array {
  const out = new Float32Array(s.length);
  const top = peak(s);
  if (top === 0) return out;
  const gain = targetPeak / top;
  for (let i = 0; i < s.length; i++) out[i] = s[i] * gain;
  return out;
}
