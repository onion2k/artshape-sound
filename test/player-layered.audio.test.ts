// The player with the v0.3.0 song fields: a layered sound as a voice's patch, a fixed voice, voices that share a patch,
// and notes that fall off the whole beats (steps, swing, offset). What it hands the Audio is read by watching `play`
// and `load`, and one test renders a layered voice to hear that it sounds where it should.
import { describe, expect, it, vi } from 'vitest';
import { Audio } from '../src/audio';
import type { Layered } from '../src/layers';
import { peak } from '../src/loudness';
import { Player } from '../src/player';
import { audioTime } from '../src/schedule';
import { notes, type Song, type Voice } from '../src/song';
import { lounge } from '../src/songs';
import { ALL_LAYERED, WIND_SECONDS } from '../src/sounds';
import { seeded } from './helpers';

const SR = 48000;
const NO_REVERB = { seconds: 0.1, decay: 3, send: 0 };
const HUM: Layered = {
  volume: 0.5,
  frequency: 440,
  layers: [{ kind: 'tone', at: 0, gain: 1, f: 440, attack: 0.001, sustain: 0.05, decay: 0.03 }],
};
const voice = (changes: Partial<Voice> = {}): Voice => ({ patch: HUM, pattern: [0], octave: 0, gain: 1, ...changes });
const song = (changes: Partial<Song> = {}): Song => ({
  bpm: 120,
  root: 81,
  scale: [0],
  chords: [[0]],
  voices: [voice()],
  ...changes,
});

interface Call {
  name: string;
  gain: number;
  pitch: number;
  at: number;
}
function setup(seconds = 3): { context: OfflineAudioContext; audio: Audio; calls: Call[]; loads: string[] } {
  const context = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const audio = new Audio({ context, random: seeded(1), reverb: NO_REVERB });
  const calls: Call[] = [];
  const loads: string[] = [];
  const play = audio.play.bind(audio);
  const load = audio.load.bind(audio);
  vi.spyOn(audio, 'play').mockImplementation((name, options = {}) => {
    calls.push({ name, gain: options.gain ?? 1, pitch: options.pitch ?? 1, at: options.at ?? NaN });
    play(name, options);
  });
  vi.spyOn(audio, 'load').mockImplementation((name, sound, options) => {
    loads.push(name);
    load(name, sound, options);
  });
  return { context, audio, calls, loads };
}

describe('a layered sound as a voice', () => {
  it('is loaded once, and its notes are bent from its own frequency', () => {
    const { audio, calls, loads } = setup();
    new Player(audio, song()).step(0.1);
    expect(loads).toHaveLength(1);
    // root 81 is 880 Hz, the layered sound's frequency 440
    expect(calls.map((c) => c.pitch)).toEqual([2]);
  });

  it('is not bent at all when the note is its own pitch', () => {
    const { audio, calls } = setup();
    new Player(audio, song({ root: 69 })).step(0.1);
    expect(calls.map((c) => c.pitch)).toEqual([1]);
  });

  it('is refused by the player, naming the field, when it has no frequency and is not fixed', () => {
    const { audio } = setup();
    const { frequency: _frequency, ...unpitched } = HUM;
    expect(() => new Player(audio, song({ voices: [voice({ patch: unpitched })] }))).toThrow(
      /Player: voices\[0\]\.patch\.frequency/,
    );
  });

  it('sounds where its note is: nothing before the first, the layered tone after', async () => {
    const { context, audio } = setup(1);
    const player = new Player(audio, song({ root: 69, voices: [voice({ pattern: [null, 0] })] }), { lookahead: 0.2 });
    // one note, on beat 1 (half a second at 120 a minute): step the clock to just short of it, and let it be scheduled
    const stop = context.suspend(0.4);
    player.step(0);
    const rendering = context.startRendering();
    await stop;
    player.step(0.4);
    await context.resume();
    const out = (await rendering).getChannelData(0);
    expect(peak(out.subarray(0, Math.round(0.49 * SR)))).toBe(0);
    expect(peak(out.subarray(Math.round(0.5 * SR), Math.round(0.6 * SR)))).toBeGreaterThan(0.1);
  });
});

describe('a fixed voice', () => {
  it('plays at the pitch it was rendered at, whatever the note says', () => {
    const { audio, calls } = setup();
    new Player(audio, song({ voices: [voice({ fixed: true })] })).step(0.1);
    expect(calls.map((c) => c.pitch)).toEqual([1]);
  });

  it('needs no frequency of its own, and a pitched voice beside it is still bent', () => {
    const { audio, calls } = setup();
    const { frequency: _frequency, ...unpitched } = HUM;
    new Player(audio, song({ voices: [voice({ patch: unpitched, fixed: true }), voice()] })).step(0.1);
    expect(calls.map((c) => c.pitch).sort()).toEqual([1, 2]);
  });
});

describe('voices that share a patch', () => {
  it('load it once, and play it under one name', () => {
    const { audio, calls, loads } = setup();
    new Player(audio, song({ voices: [voice(), voice({ gain: 0.5 }), voice({ gain: 0.25 })] })).step(0.1);
    expect(loads).toHaveLength(1);
    expect(new Set(calls.map((c) => c.name)).size).toBe(1);
    expect(calls.map((c) => c.gain)).toEqual([1, 0.5, 0.25]);
  });

  it('load a copy that is merely equal as a voice of its own', () => {
    const { audio, loads } = setup();
    new Player(audio, song({ voices: [voice(), voice({ patch: { ...HUM } })] })).step(0.1);
    expect(loads).toHaveLength(2);
  });

  it('name the shared buffer for the first voice that has it', () => {
    const { audio, calls } = setup();
    const other: Layered = { ...HUM, frequency: 220 };
    new Player(audio, song({ voices: [voice({ patch: other }), voice(), voice()] })).step(0.1);
    const names = calls.map((c) => c.name);
    expect(names[1]).toBe(names[2]);
    expect(names[0]).not.toBe(names[1]);
    expect(names[1]).toMatch(/:1$/);
  });
});

describe('notes off the whole beats', () => {
  const placed = (s: Song): { want: Call[]; got: Call[] } => {
    const { audio, calls } = setup();
    // a long lookahead, so that one step reaches a bar of swung and moved notes
    const player = new Player(audio, s, { lookahead: 1 });
    player.step(0.1);
    const end = player.beat + (1 * s.bpm) / 60;
    const want = notes(s, Math.max(0, player.beat - (1 * s.bpm) / 60), end).map((n) => ({
      name: '',
      gain: n.gain,
      pitch: 0,
      at: audioTime(n.beat, player.beat, s.bpm, 0),
    }));
    return { want, got: calls };
  };

  it('are placed on the audio clock by where they fall: steps, swing and offset all in', () => {
    const s = song({
      steps: 2,
      voices: [voice({ swing: 0.25 }), voice({ offset: 0.1, pattern: [0, null] })],
    });
    const { want, got } = placed(s);
    expect(got.length).toBeGreaterThan(3);
    expect(got.map((c) => c.at)).toEqual(want.map((c) => c.at));
    expect(got.map((c) => c.gain)).toEqual(want.map((c) => c.gain));
    // and they are not all on the beat: a swung note is later than its step
    expect(new Set(got.map((c) => Number(c.at.toFixed(6)))).size).toBeGreaterThan(2);
  });

  it('are handed over once each however the steps are cut', () => {
    const s = song({ steps: 2, voices: [voice({ swing: 0.25 }), voice({ offset: 0.3 })] });
    const whole = setup();
    const a = new Player(whole.audio, s);
    a.step(1.5);
    const cut = setup();
    const b = new Player(cut.audio, s);
    for (let i = 0; i < 15; i++) b.step(0.1);
    expect(cut.calls.length).toBeGreaterThan(4);
    // the same notes (the whole step looks 0.1 s further than the last of the cut ones)
    const upTo = Math.min(a.beat, b.beat);
    expect(cut.calls.filter((_, i) => i < notes(s, 0, upTo).length)).toHaveLength(notes(s, 0, upTo).length);
  });
});

describe('the song lounge on a Player', () => {
  const QUANTUM = 128;
  // thirty-seven render quanta, about a tenth of a second: a step the audio clock lands on exactly
  const DT = (37 * QUANTUM) / SR;

  it('loads its seven sounds once each, for seventeen voices, and plays every voice', () => {
    const { audio, calls, loads } = setup();
    const player = new Player(audio, lounge);
    expect(loads).toHaveLength(7);
    // four seconds is five and a half beats: every voice has a note by then
    for (let i = 0; i < 40; i++) player.step(0.1);
    expect(player.beat).toBeGreaterThan(5);
    expect(new Set(calls.map((c) => c.name)).size).toBe(7);
    expect(calls.length).toBeGreaterThan(30);
    // the drums at pitch 1, the bass and the piano bent to their notes
    expect(calls.filter((c) => c.pitch === 1).length).toBeGreaterThan(10);
    for (const c of calls) {
      expect(c.pitch).toBeGreaterThanOrEqual(0.25);
      expect(c.pitch).toBeLessThanOrEqual(4);
    }
  });

  it('sounds, bounded, with the clock moving: a bar and a half of it, rendered', async () => {
    const { context, audio } = setup(4);
    const player = new Player(audio, lounge);
    const stops: Promise<void>[] = [];
    for (let t = DT; t < 3.5; t += DT) stops.push(context.suspend(t));
    player.step(0);
    const rendering = context.startRendering();
    for (const stop of stops) {
      await stop;
      player.step(DT);
      await context.resume();
    }
    const out = (await rendering).getChannelData(0);
    const top = peak(out);
    expect(top).toBeGreaterThan(0.1);
    expect(top).toBeLessThanOrEqual(1);
    // and it keeps going: there is sound in the last second as well as the first
    expect(peak(out.subarray(Math.round(2.5 * SR), Math.round(3.5 * SR)))).toBeGreaterThan(0.05);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('every stock layered sound on an Audio', () => {
  for (const rate of [44100, 48000]) {
    it(`loads, with takes, and plays or loops, at ${rate} Hz`, async () => {
      const context = new OfflineAudioContext(2, rate * 2, rate);
      const audio = new Audio({ context, random: seeded(1), reverb: NO_REVERB });
      for (const [name, sound] of Object.entries(ALL_LAYERED))
        audio.load(name, sound, name === 'wind' ? { loop: WIND_SECONDS } : { variants: 2 });
      for (const name of Object.keys(ALL_LAYERED)) {
        if (name === 'wind') audio.loop(name);
        else audio.play(name, { pitch: name === 'bell' ? 0.5 : 1 });
      }
      const out = (await context.startRendering()).getChannelData(0);
      expect(peak(out)).toBeGreaterThan(0.2);
      for (const v of out) expect(Number.isFinite(v)).toBe(true);
      expect(audio.loops).toBe(1);
    });
  }
});
