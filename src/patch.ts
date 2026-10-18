// A patch is the dozen numbers that describe one sound, and checkPatch is the one door a patch comes through. A patch
// may be written by hand, saved by a game or pasted from the sheet, so it is read as if anyone had written it: what is
// out of range is refused by the name of its field, and never reaches the synth to make NaN or a buffer of length 0.

export type Wave = 'sine' | 'square' | 'saw' | 'triangle' | 'noise';

export const WAVES: readonly Wave[] = ['sine', 'square', 'saw', 'triangle', 'noise'];

// The longest sound a patch may describe. A sound effect is a second or two; the cap is here so that a typo in a
// saved patch cannot ask for a buffer of minutes.
export const MAX_SECONDS = 10;

export interface Patch {
  wave: Wave;
  frequency: number; // Hz at the start
  slide: number; // Hz per second, may be negative
  attack: number; // seconds
  sustain: number;
  release: number;
  punch: number; // 0..1, extra gain over the sustain's start
  volume: number; // 0..1 peak after normalising
  cutoff: number; // lowpass Hz; Infinity means none
  cutoffSlide: number; // Hz per second
  vibratoDepth: number; // Hz
  vibratoRate: number; // Hz
  noise: number; // 0..1 mixed in
  repeat: number; // Hz; 0 means once
  jitter: number; // 0..1, how far pitch may wander per play
}

// A plain beep that is a sound and nothing more, to start a patch from: a field added later defaults to the value that
// leaves today's sound alone. Infinity does not survive JSON (it saves as null), so a game that keeps a patch as JSON
// writes a large cutoff or puts Infinity back itself before it loads.
export const DEFAULT_PATCH: Patch = {
  wave: 'sine',
  frequency: 440,
  slide: 0,
  attack: 0.01,
  sustain: 0.2,
  release: 0.1,
  punch: 0,
  volume: 0.5,
  cutoff: Infinity,
  cutoffSlide: 0,
  vibratoDepth: 0,
  vibratoRate: 0,
  noise: 0,
  repeat: 0,
  jitter: 0,
};

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v);
}

// One numeric field: finite and within [min, max], or else a message naming it.
function range(p: Record<string, unknown>, field: keyof Patch, min: number, max: number): string | null {
  const v = p[field];
  if (!isNumber(v) || !Number.isFinite(v)) return `${field} must be a finite number, got ${String(v)}`;
  if (v < min || v > max) return `${field} must be from ${min} to ${max}, got ${v}`;
  return null;
}

// A problem with the patch, named by its field, or null when it is sound. The sample rate is not known here, so a
// frequency above the Nyquist is render's to refuse.
export function checkPatch(p: unknown): string | null {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return 'patch must be an object';
  const o = p as Record<string, unknown>;
  if (!WAVES.includes(o.wave as Wave)) return `wave must be one of ${WAVES.join(', ')}, got ${String(o.wave)}`;

  const f = o.frequency;
  if (!isNumber(f) || !Number.isFinite(f) || f <= 0) return `frequency must be a number above 0, got ${String(f)}`;
  const c = o.cutoff;
  if (!isNumber(c) || c <= 0) return `cutoff must be above 0 (Infinity for none), got ${String(c)}`;

  const checks = [
    range(o, 'slide', -1e6, 1e6),
    range(o, 'attack', 0, MAX_SECONDS),
    range(o, 'sustain', 0, MAX_SECONDS),
    range(o, 'release', 0, MAX_SECONDS),
    range(o, 'punch', 0, 1),
    range(o, 'volume', 0, 1),
    range(o, 'cutoffSlide', -1e6, 1e6),
    range(o, 'vibratoDepth', 0, 1e6),
    range(o, 'vibratoRate', 0, 1e6),
    range(o, 'noise', 0, 1),
    range(o, 'repeat', 0, 1e6),
    range(o, 'jitter', 0, 1),
  ];
  for (const problem of checks) if (problem !== null) return problem;

  const total = (o.attack as number) + (o.sustain as number) + (o.release as number);
  if (total === 0) return 'attack, sustain and release are all 0, so the sound would last no time';
  if (total > MAX_SECONDS) return `attack, sustain and release add up to ${total} s, more than ${MAX_SECONDS}`;
  return null;
}
