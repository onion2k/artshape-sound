// The Web Audio side, in headless Chromium. Almost all of it is read from an OfflineAudioContext: play, render with
// startRendering, read the channels back, so that no test waits on a clock. One test uses a real AudioContext, which
// is the only way to see that a context that is not running stays silent and does not queue.

import { describe, expect, it } from 'vitest';
import { Audio, LATE_TOLERANCE, type AudioOptions } from '../src/audio';
import { DEFAULT_PATCH, type Patch } from '../src/patch';
import { duration } from '../src/synth';
import { hit } from '../src/patches';
import { peak } from '../src/loudness';
import { seeded } from './helpers';

const SR = 48000;
// A plain tone that lasts 0.4 s, quiet enough to stay below the compressor's threshold, so a gain reads back linearly.
const TONE: Patch = { ...DEFAULT_PATCH, frequency: 200, attack: 0.01, sustain: 0.3, release: 0.09, volume: 0.5 };
const NO_REVERB = { seconds: 0.1, decay: 3, send: 0 };

interface Rendered {
  audio: Audio;
  left: Float32Array;
  right: Float32Array;
}

// Builds an Audio on a fresh offline context, lets `setup` load and play, renders `seconds` and hands the channels back.
async function rendered(
  setup: (audio: Audio) => void,
  options: Partial<AudioOptions> = {},
  seconds = 1.5,
  seed = 1,
): Promise<Rendered> {
  const context = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const audio = new Audio({ context, random: seeded(seed), reverb: NO_REVERB, ...options });
  setup(audio);
  const buffer = await context.startRendering();
  return { audio, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}

// The first and last sample above a threshold, in seconds: where the sound is and for how long.
function span(s: Float32Array, threshold = 1e-3): { start: number; end: number; length: number } {
  let first = -1;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    if (Math.abs(s[i]) > threshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return { start: 0, end: 0, length: 0 };
  return { start: first / SR, end: (last + 1) / SR, length: (last + 1 - first) / SR };
}

const tone = (audio: Audio): void => audio.load('tone', TONE);

describe('play', () => {
  it('sounds a loaded stock patch for its duration plus the reverb tail', async () => {
    const reverb = { seconds: 0.5, decay: 3, send: 0.5 };
    const { left } = await rendered(
      (a) => {
        a.load('hit', hit);
        a.play('hit');
      },
      { reverb },
    );
    const { end } = span(left);
    // Past the dry sound by a good part of the tail, and no further than the tail's end.
    expect(end).toBeGreaterThan(duration(hit) + 0.2);
    expect(end).toBeLessThan(duration(hit) + reverb.seconds + 0.05);
  });

  it('lasts only its duration when the reverb sends nothing', async () => {
    const { left } = await rendered((a) => {
      tone(a);
      a.play('tone');
    });
    const { end } = span(left);
    expect(end).toBeGreaterThan(duration(TONE) - 0.02);
    expect(end).toBeLessThan(duration(TONE) + 0.02);
  });

  it('scales the peak with gain', async () => {
    const quiet = await rendered((a) => {
      tone(a);
      a.play('tone', { gain: 0.1 });
    });
    const loud = await rendered((a) => {
      tone(a);
      a.play('tone', { gain: 0.2 });
    });
    const ratio = peak(loud.left) / peak(quiet.left);
    expect(peak(quiet.left)).toBeGreaterThan(0.01);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });

  it('halves the sounding length at pitch 2', async () => {
    const plain = await rendered((a) => {
      tone(a);
      a.play('tone');
    });
    const up = await rendered((a) => {
      tone(a);
      a.play('tone', { pitch: 2 });
    });
    expect(span(up.left).length / span(plain.left).length).toBeGreaterThan(0.47);
    expect(span(up.left).length / span(plain.left).length).toBeLessThan(0.53);
  });

  it('puts the energy in the left channel at pan -1 and the right at pan 1', async () => {
    const left = await rendered((a) => {
      tone(a);
      a.play('tone', { pan: -1 });
    });
    const right = await rendered((a) => {
      tone(a);
      a.play('tone', { pan: 1 });
    });
    expect(peak(left.left)).toBeGreaterThan(0.01);
    expect(peak(left.right)).toBeLessThan(peak(left.left) / 100);
    expect(peak(right.right)).toBeGreaterThan(0.01);
    expect(peak(right.left)).toBeLessThan(peak(right.right) / 100);
  });

  it('refuses a pitch outside (0, 4], a pan outside [-1, 1] and a bad gain, by name', async () => {
    const { audio } = await rendered(tone);
    for (const pitch of [0, -1, 4.5, 8, NaN]) expect(() => audio.play('tone', { pitch })).toThrow(/pitch/);
    for (const pan of [-1.5, 2, NaN]) expect(() => audio.play('tone', { pan })).toThrow(/pan/);
    for (const gain of [-1, NaN, Infinity]) expect(() => audio.play('tone', { gain })).toThrow(/gain/);
    expect(audio.voices).toBe(0);
  });

  it('refuses an unknown name, by name', async () => {
    const { audio } = await rendered(tone);
    expect(() => audio.play('nothing')).toThrow(/nothing/);
  });
});

describe('voices', () => {
  it('cuts the oldest at capacity, and voices never exceeds it', async () => {
    const seen: number[] = [];
    const { audio, left, right } = await rendered(
      (a) => {
        tone(a);
        // The first voice is the only one on the left, so if it were not cut the left would sound.
        a.play('tone', { pan: -1 });
        seen.push(a.voices);
        a.play('tone', { pan: 1 });
        seen.push(a.voices);
        a.play('tone', { pan: 1 });
        seen.push(a.voices);
      },
      { capacity: 2 },
    );
    expect(seen).toEqual([1, 2, 2]);
    expect(peak(left)).toBeLessThan(peak(right) / 100);
    expect(peak(right)).toBeGreaterThan(0.01);
    expect(audio).toBeDefined();
  });

  it('keeps the first voice when there is room for it', async () => {
    const { left } = await rendered(
      (a) => {
        tone(a);
        a.play('tone', { pan: -1 });
        a.play('tone', { pan: 1 });
        a.play('tone', { pan: 1 });
      },
      { capacity: 3 },
    );
    expect(peak(left)).toBeGreaterThan(0.01);
  });

  it('lets a voice that has ended leave the count', async () => {
    const { audio } = await rendered((a) => {
      tone(a);
      a.play('tone');
      a.play('tone');
      expect(a.voices).toBe(2);
    });
    // The ended events are queued as tasks when rendering finishes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(audio.voices).toBe(0);
  });

  it('holds sixteen at most by default', async () => {
    let most = 0;
    await rendered((a) => {
      tone(a);
      for (let i = 0; i < 40; i++) {
        a.play('tone');
        most = Math.max(most, a.voices);
      }
    });
    expect(most).toBe(16);
  });
});

describe('load', () => {
  it('refuses a bad patch by the name of its field, and keeps nothing of it', async () => {
    const { audio } = await rendered(tone);
    expect(() => audio.load('bad', { ...TONE, frequency: 0 })).toThrow(/frequency/);
    expect(() => audio.load('worse', { ...TONE, attack: 0, sustain: 0, release: 0 })).toThrow();
    expect(() => audio.play('bad')).toThrow(/bad/);
  });

  it("refuses a patch past the context's Nyquist, by name", async () => {
    const { audio } = await rendered(() => undefined);
    expect(() => audio.load('high', { ...TONE, frequency: 30000 })).toThrow(/Nyquist/);
  });

  it('replaces a sound loaded twice under one name', async () => {
    const { left } = await rendered((a) => {
      tone(a);
      a.load('tone', { ...TONE, sustain: 0.1, release: 0.05, attack: 0.01 });
      a.play('tone');
    });
    expect(span(left).end).toBeLessThan(0.2);
  });
});

describe('mute', () => {
  it('gives silence while on, and sound again when off', async () => {
    const muted = await rendered((a) => {
      tone(a);
      a.mute(true);
      a.play('tone');
    });
    expect(peak(muted.left)).toBe(0);
    const back = await rendered((a) => {
      tone(a);
      a.mute(true);
      a.mute(false);
      a.play('tone');
    });
    expect(peak(back.left)).toBeGreaterThan(0.01);
  });
});

describe('dispose', () => {
  it('makes every later call throw, by name', async () => {
    const { audio } = await rendered(tone);
    audio.dispose();
    expect(() => audio.play('tone')).toThrow(/disposed/);
    expect(() => audio.load('tone', TONE)).toThrow(/disposed/);
    expect(() => audio.mute(true)).toThrow(/disposed/);
    await expect(audio.resume()).rejects.toThrow(/disposed/);
  });

  it('stops every voice, and may be called twice', async () => {
    const { audio, left } = await rendered((a) => {
      tone(a);
      a.play('tone');
      a.play('tone');
      a.dispose();
      expect(a.voices).toBe(0);
    });
    expect(peak(left)).toBe(0);
    expect(() => audio.dispose()).not.toThrow();
  });
});

describe('chance', () => {
  it('renders the same bytes twice from the same seed, jitter and reverb included, and others from another', async () => {
    const jittery: Patch = { ...TONE, jitter: 0.3, wave: 'noise', noise: 0.5 };
    const reverb = { seconds: 0.3, decay: 3, send: 0.4 };
    const run = (seed: number): Promise<Rendered> =>
      rendered(
        (a) => {
          a.load('j', jittery);
          a.play('j');
        },
        { reverb },
        1,
        seed,
      );
    const a = await run(7);
    const b = await run(7);
    const c = await run(8);
    expect(Array.from(b.left)).toEqual(Array.from(a.left));
    expect(Array.from(b.right)).toEqual(Array.from(a.right));
    expect(Array.from(c.left)).not.toEqual(Array.from(a.left));
  });
});

describe('resume', () => {
  it('is a no-op on an offline context, and play works at once', async () => {
    const context = new OfflineAudioContext(2, SR, SR);
    const audio = new Audio({ context, random: seeded(1), reverb: NO_REVERB });
    await audio.resume();
    expect(context.state).toBe('suspended');
    tone(audio);
    audio.play('tone');
    expect(audio.voices).toBe(1);
  });
});

describe('a real AudioContext', () => {
  // Reads the analyser for as long as the audio clock takes to move `seconds`, and gives the largest sample seen.
  async function loudest(context: AudioContext, analyser: AnalyserNode, seconds: number): Promise<number> {
    const data = new Float32Array(analyser.fftSize);
    const until = context.currentTime + seconds;
    let most = 0;
    while (context.currentTime < until) {
      analyser.getFloatTimeDomainData(data);
      most = Math.max(most, peak(data));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return most;
  }

  it('is silent and queues nothing before resume, and is heard after', async () => {
    const context = new AudioContext({ sampleRate: SR });
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    // An analyser is only pulled when something downstream wants it, so it ends in a gain of nothing.
    const sink = context.createGain();
    sink.gain.value = 0;
    analyser.connect(sink).connect(context.destination);
    const audio = new Audio({ context, random: seeded(1), reverb: NO_REVERB, destination: analyser });
    audio.load('long', { ...TONE, sustain: 1.5, release: 0.1, volume: 0.5 });

    await context.suspend();
    expect(context.state).toBe('suspended');
    audio.play('long');
    expect(audio.voices).toBe(0);

    await audio.resume();
    expect(context.state).toBe('running');
    // Had the play been queued, the long tone would be sounding now.
    expect(await loudest(context, analyser, 0.3)).toBeLessThan(1e-4);

    audio.play('long');
    expect(audio.voices).toBe(1);
    expect(await loudest(context, analyser, 0.3)).toBeGreaterThan(0.05);

    audio.dispose();
    await context.close();
  });
});

describe('play at a time', () => {
  it('starts the sound at the audio-clock time given, and not before', async () => {
    const { left } = await rendered((a) => {
      tone(a);
      a.play('tone', { at: 0.5 });
    });
    const { start } = span(left);
    expect(start).toBeGreaterThan(0.5 - 0.005);
    expect(start).toBeLessThan(0.5 + 0.02);
  });

  it('starts at once when no time is given', async () => {
    const { left } = await rendered((a) => {
      tone(a);
      a.play('tone');
    });
    expect(span(left).start).toBeLessThan(0.02);
  });

  it('refuses a time that is not a number or is not finite, by name', async () => {
    const { audio } = await rendered(tone);
    for (const at of [NaN, Infinity, -Infinity]) expect(() => audio.play('tone', { at })).toThrow(/at/);
    expect(audio.voices).toBe(0);
  });

  it('refuses a time in the past by more than the tolerance, and lets a near miss through', () => {
    const context = new OfflineAudioContext(2, SR, SR);
    const audio = new Audio({ context, random: seeded(1), reverb: NO_REVERB });
    tone(audio);
    // Offline time stands at 0 until the render, so -1 is a second late.
    expect(() => audio.play('tone', { at: -1 })).toThrow(/at/);
    expect(() => audio.play('tone', { at: -LATE_TOLERANCE * 2 })).toThrow(/past/);
    expect(audio.voices).toBe(0);
    audio.play('tone', { at: -LATE_TOLERANCE / 2 });
    expect(audio.voices).toBe(1);
  });
});
