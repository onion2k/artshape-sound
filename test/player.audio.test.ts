// The player in headless Chromium, on an OfflineAudioContext. An offline context's clock moves only as it renders, so a
// test reads what was scheduled by watching Audio.play, and where a note falls by rendering and finding its onset in
// the samples. To step a song through a bar with the clock moving, the context is suspended at each step's time (a
// multiple of the render quantum, so the clock reads exactly what the game's time says), the player stepped, and the
// render resumed: no test waits on a wall clock.

import { describe, expect, it, vi } from 'vitest';
import { Audio } from '../src/audio';
import { DEFAULT_PATCH, type Patch } from '../src/patch';
import { Player } from '../src/player';
import { notes, type Song } from '../src/song';
import { calm } from '../src/songs';
import { rmsOfDifference, seeded } from './helpers';

const SR = 48000;
const QUANTUM = 128;
// Thirty-seven render quanta, about a tenth of a second: a step the audio clock lands on exactly.
const DT = (37 * QUANTUM) / SR;
const NO_REVERB = { seconds: 0.1, decay: 3, send: 0 };

// One bare sine a beat, an octave above its patch, so that where it starts is easy to find and its pitch is 2.
const TONE: Patch = {
  ...DEFAULT_PATCH,
  wave: 'sine',
  frequency: 440,
  attack: 0.001,
  sustain: 0.05,
  release: 0.04,
  volume: 0.5,
};
const BEAT_SONG: Song = {
  bpm: 90,
  root: 81,
  scale: [0],
  chords: [[0]],
  voices: [{ patch: TONE, pattern: [0], octave: 0, gain: 1 }],
};

interface Call {
  name: string;
  gain: number;
  pitch: number;
  at: number;
}

interface Setup {
  context: OfflineAudioContext;
  audio: Audio;
  calls: Call[];
}

// An Audio on a fresh offline context whose play is watched, and passed through.
function setup(seconds = 4, seed = 1): Setup {
  const context = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const audio = new Audio({ context, random: seeded(seed), reverb: NO_REVERB });
  const calls: Call[] = [];
  const play = audio.play.bind(audio);
  vi.spyOn(audio, 'play').mockImplementation((name, options = {}) => {
    calls.push({ name, gain: options.gain ?? 1, pitch: options.pitch ?? 1, at: options.at ?? NaN });
    play(name, options);
  });
  return { context, audio, calls };
}

// Steps the player every DT of audio time from 0 until `until` seconds, with the render running, and gives the channels.
async function steppedThrough(
  context: OfflineAudioContext,
  player: Player,
  until: number,
): Promise<{ left: Float32Array; right: Float32Array }> {
  const stops: Promise<void>[] = [];
  for (let t = DT; t < until; t += DT) stops.push(context.suspend(t));
  player.step(0);
  const rendering = context.startRendering();
  for (const stop of stops) {
    await stop;
    player.step(DT);
    await context.resume();
  }
  const buffer = await rendering;
  return { left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}

// Where each sound starts, in seconds: a sample above the threshold after a quiet stretch of at least `quiet` seconds.
function onsets(s: Float32Array, threshold = 0.01, quiet = 0.2): number[] {
  const found: number[] = [];
  let lastLoud = -Infinity;
  for (let i = 0; i < s.length; i++) {
    if (Math.abs(s[i]) <= threshold) continue;
    if ((i - lastLoud) / SR > quiet) found.push(i / SR);
    lastLoud = i;
  }
  return found;
}

describe('the notes of a bar', () => {
  it('start at the beats the sequencer says, found in the rendered samples', async () => {
    const { context, audio } = setup(2.5);
    const player = new Player(audio, BEAT_SONG);
    const { left } = await steppedThrough(context, player, 2.5);
    const found = onsets(left);
    const expected = notes(BEAT_SONG, 0, 4).map((n) => (n.beat * 60) / BEAT_SONG.bpm);
    expect(expected).toHaveLength(4);
    expect(found).toHaveLength(4);
    // The compressor delays everything by about six milliseconds to look ahead, the same for every note, so each onset
    // is that late and no later; what the player has to get right is that the delay does not vary from note to note.
    const late = found.map((f, i) => f - expected[i]);
    for (const l of late) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThan(0.01);
    }
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.002);
  });

  it('are bent to the note from the voice patch they were rendered at', () => {
    const { audio, calls } = setup();
    new Player(audio, BEAT_SONG).step(0.1);
    // Root 81 is 880 Hz and the patch is 440 Hz.
    expect(calls.map((c) => c.pitch)).toEqual([2]);
    // And against that patch's own frequency and not a fixed one: the same note from a patch at 880 Hz is not bent.
    const other = setup();
    const patched = { ...BEAT_SONG, voices: [{ ...BEAT_SONG.voices[0], patch: { ...TONE, frequency: 880 } }] };
    new Player(other.audio, patched).step(0.1);
    expect(other.calls.map((c) => c.pitch)).toEqual([1]);
  });

  it('keep the pitch inside what Audio can play, and are not refused, three octaves out', () => {
    const { audio, calls } = setup();
    new Player(audio, { ...BEAT_SONG, root: 105 }).step(0.1);
    new Player(audio, { ...BEAT_SONG, root: 33 }).step(0.1);
    expect(calls.map((c) => c.pitch)).toEqual([4, 0.25]);
  });

  it("carry the voice's gain", () => {
    const { audio, calls } = setup();
    new Player(audio, { ...BEAT_SONG, voices: [{ ...BEAT_SONG.voices[0], gain: 0.3 }] }).step(0.1);
    expect(calls.map((c) => c.gain)).toEqual([0.3]);
  });

  it('are loaded under names of the player, one per voice, that two players do not share', () => {
    const { audio, calls } = setup();
    new Player(audio, calm).step(0.1);
    new Player(audio, BEAT_SONG).step(0.1);
    const names = new Set(calls.map((c) => c.name));
    for (const name of names) expect(name).toMatch(/^song\d+:\d+$/);
    const first = calls.filter((c) => c.pitch !== 2).map((c) => c.name.split(':')[0]);
    const second = calls.filter((c) => c.pitch === 2).map((c) => c.name.split(':')[0]);
    expect(new Set([...first, ...second]).size).toBe(2);
  });
});

describe('step', () => {
  it('moves the beat by dt at the tempo', () => {
    const { audio } = setup();
    const player = new Player(audio, calm);
    expect(player.beat).toBe(0);
    player.step(2);
    expect(player.beat).toBeCloseTo(3, 12);
  });

  it('schedules the notes within the lookahead and no further, at their time on the audio clock', () => {
    const { audio, calls } = setup();
    // The beat after this step is 0.15, so the lookahead reaches 0.3 beats: the notes on beat 0, none on beat 1.
    new Player(audio, calm).step(0.1);
    expect(calls).toHaveLength(notes(calm, 0, 0.3).length);
    expect(calls.length).toBeGreaterThan(0);
    // Late by the step, so at once: the audio clock reads 0.
    for (const c of calls) expect(c.at).toBe(0);
    // A later note is placed ahead of the clock by its distance from the beat.
    const { audio: ahead, calls: later } = setup();
    const p = new Player(ahead, BEAT_SONG);
    p.step(0.1);
    p.step(0.5);
    // At 90 a minute the beat is 0.9, and the note on beat 1 is 0.1 beat, 1/15 s, ahead.
    expect(later).toHaveLength(2);
    expect(later[0].at).toBe(0);
    expect(later[1].at).toBeCloseTo((0.1 * 60) / 90, 9);
  });

  it('adds nothing for step(0) after a step', () => {
    const { audio, calls } = setup();
    const player = new Player(audio, calm);
    player.step(0.1);
    const before = calls.length;
    const beat = player.beat;
    player.step(0);
    player.step(0);
    expect(calls).toHaveLength(before);
    expect(player.beat).toBe(beat);
  });

  it('schedules the same in two steps of 0.05 as in one of 0.1', () => {
    const one = setup();
    new Player(one.audio, calm).step(0.1);
    const two = setup();
    const player = new Player(two.audio, calm);
    player.step(0.05);
    player.step(0.05);
    expect(two.calls.length).toBeGreaterThan(0);
    expect(two.calls).toHaveLength(one.calls.length);
    // The same names for the notes, as the players' names are numbered the one after the other.
    const bare = (cs: Call[]): unknown[] => cs.map((c) => [c.name.split(':')[1], c.pitch, c.gain, c.at]);
    expect(bare(two.calls)).toEqual(bare(one.calls));
  });

  it('schedules never a note twice, however the steps fall', () => {
    const { audio, calls } = setup();
    const player = new Player(audio, BEAT_SONG);
    for (const dt of [0.016, 0, 0.03, 0.2, 0.05, 0.4, 0, 0.1]) player.step(dt);
    // The beat is at about 1.2 by now, so the notes on beats 0 and 1 and no more, once each.
    expect(calls).toHaveLength(notes(BEAT_SONG, 0, 2).length);
  });

  it('after a long sleep moves the beat but schedules only the notes within the lookahead, not a burst', () => {
    const { audio, calls } = setup();
    const player = new Player(audio, calm);
    player.step(60);
    expect(player.beat).toBeCloseTo(90, 9);
    const lookahead = (0.1 * calm.bpm) / 60;
    // Everything from the new beat's own lookahead window, and nothing of the 90 beats skipped.
    expect(calls).toHaveLength(notes(calm, 90 - lookahead, 90 + lookahead).length);
    for (const c of calls) expect(c.at).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('honours a lookahead given', () => {
    const { audio, calls } = setup();
    // At 90 a minute, 2 s is 3 beats: the notes of beats 0 to 3 are all ahead at once.
    new Player(audio, BEAT_SONG, { lookahead: 2 }).step(0);
    expect(calls).toHaveLength(notes(BEAT_SONG, 0, 3).length);
  });

  it('refuses a dt that is negative or not finite, by name', () => {
    const { audio } = setup();
    const player = new Player(audio, calm);
    for (const dt of [-0.1, NaN, Infinity]) expect(() => player.step(dt)).toThrow(/dt/);
    expect(player.beat).toBe(0);
  });
});

describe('stop', () => {
  it('leaves the beat where it is, schedules nothing, and a step goes on from the same beat', () => {
    // The first step leaves the note on beat 1 handed over already, being inside the lookahead of beat 0.9.
    const straight = setup();
    const a = new Player(straight.audio, BEAT_SONG);
    a.step(0.1);
    a.step(0.5);
    a.step(0.1);

    const stopped = setup();
    const b = new Player(stopped.audio, BEAT_SONG);
    b.step(0.1);
    b.step(0.5);
    const beat = b.beat;
    const scheduled = stopped.calls.length;
    b.stop();
    expect(b.beat).toBe(beat);
    expect(stopped.calls).toHaveLength(scheduled);
    b.step(0.1);
    expect(b.beat).toBeCloseTo(a.beat, 12);
    // Nothing played twice, and nothing lost, for having stopped.
    expect(stopped.calls.map((c) => [c.pitch, c.at])).toEqual(straight.calls.map((c) => [c.pitch, c.at]));
    expect(stopped.calls).toHaveLength(2);
  });
});

describe('chance', () => {
  // All of the first bar handed over before the render starts, by a lookahead as long as the bar, so that nothing
  // happens on the main thread while the audio thread is rendering.
  const run = async (song: Song, seed: number): Promise<Float32Array> => {
    const { context, audio } = setup(3.2, seed);
    new Player(audio, song, { lookahead: 2.6 }).step(0);
    return (await context.startRendering()).getChannelData(0);
  };
  const noisy: Song = {
    ...BEAT_SONG,
    voices: [{ ...BEAT_SONG.voices[0], patch: { ...TONE, wave: 'noise', jitter: 0.3 } }],
  };

  it('renders the same bytes twice from one seed and the same beat, and others from another', async () => {
    // A song whose notes do not overlap: where voices overlap Chrome sums them in an order it does not keep, and the
    // last bit of a float differs from one render to the next, which is not the player's to hold.
    const a = await run(noisy, 7);
    const b = await run(noisy, 7);
    const c = await run(noisy, 8);
    expect(a.some((x) => Math.abs(x) > 0.01)).toBe(true);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });

  it('renders the stock song the same, to a part in a million, where its voices overlap', async () => {
    const a = await run(calm, 7);
    const b = await run(calm, 7);
    expect(a.some((x) => Math.abs(x) > 0.01)).toBe(true);
    expect(rmsOfDifference(a, b)).toBeLessThan(1e-6);
    expect(rmsOfDifference(a, await run(calm, 7))).toBeLessThan(1e-6);
  });

  it('renders the same, to a part in a million, when stepped through the bar with the render running', async () => {
    // A voice that has ended is let go on the main thread while the audio thread renders, which can change what the
    // bus sums in what order. Nobody hears it; the sum stays equal.
    const through = async (seed: number): Promise<Float32Array> => {
      const { context, audio } = setup(3.2, seed);
      return (await steppedThrough(context, new Player(audio, calm), 2.6)).left;
    };
    const a = await through(7);
    const b = await through(7);
    expect(a.some((x) => Math.abs(x) > 0.01)).toBe(true);
    expect(rmsOfDifference(a, b)).toBeLessThan(1e-6);
    // And it is the same music as the one handed over whole: a note in the same place.
    expect(rmsOfDifference(a, await run(calm, 7))).toBeLessThan(0.01);
  });
});

describe('a song that is refused', () => {
  it('is named by its field, whatever it is', () => {
    const { audio, calls } = setup();
    expect(() => new Player(audio, { ...calm, bpm: 0 })).toThrow(/Player.*bpm/);
    expect(() => new Player(audio, { ...calm, root: 200 })).toThrow(/Player.*root/);
    expect(() => new Player(audio, null as unknown as Song)).toThrow(/Player.*song/);
    const bad = { ...calm, voices: [{ ...calm.voices[0], patch: { ...TONE, frequency: 0 } }] };
    expect(() => new Player(audio, bad)).toThrow(/Player.*voices\[0\]\.patch.*frequency/);
    expect(calls).toHaveLength(0);
  });

  it('is refused for a lookahead that is not above 0, by name', () => {
    const { audio } = setup();
    for (const lookahead of [0, -1, NaN, Infinity]) {
      expect(() => new Player(audio, calm, { lookahead })).toThrow(/lookahead/);
    }
  });
});

describe('dispose', () => {
  it('makes the next step that has a note to play throw, by name, and a new player too', () => {
    const { audio } = setup();
    const player = new Player(audio, calm);
    audio.dispose();
    expect(() => player.step(0.1)).toThrow(/disposed/);
    expect(() => new Player(audio, calm)).toThrow(/disposed/);
  });
});
