// The reverb's impulse response: noise under an exponential decay, which a ConvolverNode turns into a room. Made here
// in plain numbers, and not by loading a recording, so that no file is downloaded and the same seed gives the same room
// on every machine. Without it the Web Audio side would have to ship an impulse as data.

// `seconds` long at the sample rate, `decay` the number of e-folds over the length (3 is a gentle tail, 6 a dull
// one). One draw of `random` a sample, and `random` is required: Audio passes its own, so that nothing in src/ but
// synth.ts reads the global source.
export function impulse(seconds: number, decay: number, sampleRate: number, random: () => number): Float32Array {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`impulse: seconds must be above 0, got ${seconds}`);
  if (!Number.isFinite(decay) || decay < 0) throw new Error(`impulse: decay must be 0 or more, got ${decay}`);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new Error(`impulse: sampleRate must be above 0, got ${sampleRate}`);
  const length = Math.round(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (2 * random() - 1) * Math.exp((-decay * i) / length);
  return out;
}
