// A song is a tempo, a key, a loop of chords and a pattern for each voice, and notes() turns it into the notes that fall
// in a range of beats. It is pure: the same song and range give the same notes on every call, with no clock and no
// chance, so a song can be stepped headless in a test and hashed. checkSong is the one door a song comes through,
// because a song may be written by hand or kept as JSON: what is out of range is refused by the name of its field and
// never reaches notes() to divide by zero or make a note that is not a number.
//
// How to predict a note. A beat is one step of every pattern, and a bar is four beats. The chord a beat is in is
// chords[floor(beat / 4) mod chords.length], and the chords go round for ever. A voice plays pattern[beat mod
// pattern.length] on each whole beat, and a null there is a rest. A number n in a pattern is a place in the current
// chord, not a place in the scale: 0 is the chord's first degree (its root), 1 the next, and so on. Past the end of
// the chord it wraps to the start, an octave higher for each time round, so with a three-note chord n = 3 is the root
// an octave up and n = 7 is the next degree two octaves up. That is
//
//   degree = chord[n mod chord.length]        carry = floor(n / chord.length)
//   midi   = root + 12 * (voice.octave + carry) + scale[degree]
//   Hz     = 440 * 2 ^ ((midi - 69) / 12)
//
// so root 60 (middle C), scale [0, 2, 4, 5, 7, 9, 11], chord [0, 2, 4], n = 1 and octave 0 gives 60 + scale[2] = 64, E.
// A chord is therefore a list of degrees of the scale, each below scale.length, and the notes of a chord need not
// ascend: [4, 6, 1] is G, B, then D below the G unless the pattern carries it up. The midi note may leave 0..127 for a
// high root and octave, and the frequency is still the formula's; the voice's patch and the game's speakers decide
// whether it can be heard.
//
// Steps, swing, offset and fixed. A song may have `steps` steps to a beat (default 1, which is all the above), and then
// a pattern is read a step at a time: step s is on beat s / steps, a bar is still four beats (so steps * 4 steps), and
// the chord of a step is the chord of its bar. A voice's `swing` delays every odd step by that share of a step (a
// third of a step is a triplet feel; 0, the default, is straight), its `offset` moves every note of it by that many
// beats (a strum is chord voices each a little later), and a `fixed` voice, a drum, is played at its own pitch whatever
// its pattern says. A note then falls on the beat it is moved to, which is not a whole number any more, and a range
// holds the notes by where they fall: s / steps + (swing if s is odd) / steps + offset. All four default to nothing, so
// a song written without them is the song it was.

import { checkLayered, isLayered, type Layered } from './layers';
import { checkPatch, type Patch } from './patch';

export interface Voice {
  patch: Patch | Layered; // the sound of one note; a layered one is bent from its `frequency`
  pattern: readonly (number | null)[]; // a place in the chord for each step, or null for a rest; it wraps
  octave: number; // whole octaves added to the key, -4..4
  gain: number; // 0..1 of the voice against the others
  swing?: number; // 0..0.75, the share of a step every odd step is delayed by; default 0
  fixed?: boolean; // true for a voice (a drum) that keeps its own pitch; default false
  offset?: number; // -1..1, beats every note of the voice is moved by, for a strum; default 0
}

export interface Song {
  bpm: number; // beats per minute
  root: number; // MIDI note of the key, 0..127
  scale: readonly number[]; // semitone steps above the root, ascending, each 0..11: [0, 2, 4, 5, 7, 9, 11] is major
  chords: readonly (readonly number[])[]; // degrees of the scale, one chord a bar, going round
  voices: readonly Voice[];
  steps?: number; // steps to a beat, 1 to 16; default 1
}

export interface Note {
  beat: number; // the beat it falls on: whole unless the song has steps, or its voice a swing or an offset
  frequency: number; // Hz
  voice: number; // an index into song.voices
  gain: number; // the voice's
}

/** Beats in a bar: how long a chord lasts. */
export const BEATS_PER_BAR = 4;
/** The most steps a song may have to a beat. */
export const MAX_STEPS = 16;

const isNumber = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
const isWhole = (v: unknown, min: number, max: number): v is number =>
  isNumber(v) && Number.isInteger(v) && v >= min && v <= max;

/** A value as a message shows it: an object by its JSON, since String() of one says nothing. */
const show = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? String(v) : JSON.stringify(v));

/** The remainder of a over b that is never negative, so a beat before the start still has a place. */
const mod = (a: number, b: number): number => ((a % b) + b) % b;

function checkVoice(v: unknown, at: string): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${at} must be an object`;
  const o = v as Record<string, unknown>;
  const layered = isLayered(o.patch);
  const patch = layered ? checkLayered(o.patch) : checkPatch(o.patch);
  if (patch !== null) return `${at}.patch: ${patch}`;
  if (o.fixed !== undefined && typeof o.fixed !== 'boolean')
    return `${at}.fixed must be true or false, got ${show(o.fixed)}`;
  // A layered sound has no one frequency of its own to bend from, so a voice that is to be pitched must say it.
  if (layered && o.fixed !== true && (o.patch as Layered).frequency === undefined)
    return `${at}.patch.frequency must be set on a layered voice that is not fixed, as the pitch notes are bent from`;
  const pattern = o.pattern;
  if (!Array.isArray(pattern) || pattern.length === 0) return `${at}.pattern must be a list with at least one step`;
  for (let i = 0; i < pattern.length; i++) {
    const step: unknown = pattern[i];
    if (step !== null && !isWhole(step, 0, Number.MAX_SAFE_INTEGER)) {
      return `${at}.pattern[${i}] must be a whole number from 0, or null for a rest, got ${show(step)}`;
    }
  }
  if (!isWhole(o.octave, -4, 4)) return `${at}.octave must be a whole number from -4 to 4, got ${String(o.octave)}`;
  const g = o.gain;
  if (!isNumber(g) || g < 0 || g > 1) return `${at}.gain must be from 0 to 1, got ${String(g)}`;
  const swing = o.swing;
  if (swing !== undefined && (!isNumber(swing) || swing < 0 || swing > 0.75))
    return `${at}.swing must be from 0 to 0.75, got ${show(swing)}`;
  const offset = o.offset;
  if (offset !== undefined && (!isNumber(offset) || !Number.isFinite(offset) || offset < -1 || offset > 1))
    return `${at}.offset must be from -1 to 1 beats, got ${show(offset)}`;
  return null;
}

// A problem with the song, named by its field, or null when it is sound.
export function checkSong(s: unknown): string | null {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return 'song must be an object';
  const o = s as Record<string, unknown>;
  const bpm = o.bpm;
  if (!isNumber(bpm) || !Number.isFinite(bpm) || bpm <= 0) return `bpm must be a number above 0, got ${String(bpm)}`;
  if (!isWhole(o.root, 0, 127)) return `root must be a MIDI note, a whole number from 0 to 127, got ${String(o.root)}`;
  if (o.steps !== undefined && !isWhole(o.steps, 1, MAX_STEPS))
    return `steps must be a whole number from 1 to ${MAX_STEPS}, got ${show(o.steps)}`;

  const scale = o.scale;
  if (!Array.isArray(scale) || scale.length === 0) return 'scale must be a list with at least one step';
  for (let i = 0; i < scale.length; i++) {
    const step: unknown = scale[i];
    if (!isWhole(step, 0, 11))
      return `scale[${i}] must be a whole number of semitones from 0 to 11, got ${String(step)}`;
    if (i > 0 && step <= (scale[i - 1] as number))
      return `scale must ascend, but scale[${i}] is ${step} after ${String(scale[i - 1])}`;
  }

  const chords = o.chords;
  if (!Array.isArray(chords) || chords.length === 0) return 'chords must be a list with at least one chord';
  for (let i = 0; i < chords.length; i++) {
    const chord: unknown = chords[i];
    if (!Array.isArray(chord) || chord.length === 0) return `chords[${i}] must be a list with at least one degree`;
    for (let j = 0; j < chord.length; j++) {
      const degree: unknown = chord[j];
      if (!isWhole(degree, 0, scale.length - 1)) {
        return `chords[${i}][${j}] must be a degree of the scale, a whole number from 0 to ${scale.length - 1}, got ${String(degree)}`;
      }
    }
  }

  const voices = o.voices;
  if (!Array.isArray(voices)) return 'voices must be a list';
  for (let i = 0; i < voices.length; i++) {
    const problem = checkVoice(voices[i], `voices[${i}]`);
    if (problem !== null) return problem;
  }
  return null;
}

// Every note whose beat is in [fromBeat, toBeat): one that falls exactly on fromBeat is in and one exactly on toBeat is
// out, so a player that asks for one range after another hears each note once. In beat order, then voice order. Beats
// before 0 have notes too, as the chords and patterns go round both ways. The song is trusted to have passed
// checkSong; a range that is not finite is refused here, being a bug in the caller and not in a song.
export function notes(song: Song, fromBeat: number, toBeat: number): Note[] {
  if (!Number.isFinite(fromBeat)) throw new RangeError(`fromBeat must be a finite number, got ${fromBeat}`);
  if (!Number.isFinite(toBeat)) throw new RangeError(`toBeat must be a finite number, got ${toBeat}`);
  const steps = song.steps ?? 1;
  // How far any voice moves a step from its place, so as to know which steps could land in the range.
  let earliest = 0;
  let latest = 0;
  let swingest = 0;
  for (const voice of song.voices) {
    earliest = Math.min(earliest, voice.offset ?? 0);
    latest = Math.max(latest, voice.offset ?? 0);
    swingest = Math.max(swingest, voice.swing ?? 0);
  }
  const bent = earliest !== 0 || latest !== 0 || swingest !== 0;
  const out: Note[] = [];
  const last = Math.ceil((toBeat - earliest) * steps) + 1;
  for (let step = Math.floor((fromBeat - latest) * steps - swingest) - 1; step < last; step++) {
    const chord = song.chords[mod(Math.floor(step / (steps * BEATS_PER_BAR)), song.chords.length)];
    const odd = mod(step, 2) === 1;
    for (let v = 0; v < song.voices.length; v++) {
      const voice = song.voices[v];
      const beat = (step + (odd ? (voice.swing ?? 0) : 0)) / steps + (voice.offset ?? 0);
      if (beat < fromBeat || beat >= toBeat) continue;
      const place = voice.pattern[mod(step, voice.pattern.length)];
      if (place === null) continue;
      const degree = chord[place % chord.length];
      const carry = Math.floor(place / chord.length);
      const midi = song.root + 12 * (voice.octave + carry) + song.scale[degree];
      out.push({ beat, frequency: 440 * 2 ** ((midi - 69) / 12), voice: v, gain: voice.gain });
    }
  }
  // Steps come in order, but a swung or moved note may pass its neighbours, so it is sorted by where it falls.
  if (bent) out.sort((a, b) => a.beat - b.beat || a.voice - b.voice);
  return out;
}
