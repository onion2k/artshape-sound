// A layered sound through the Web Audio side, in headless Chromium on an OfflineAudioContext: a Layered loaded with
// takes that play round, a loop that starts, loops, changes its gain and stops, and the volume and the mute that hold
// for both. Nothing waits on a clock: the context is rendered, or suspended at a time of its own choosing.
import { describe, expect, it } from 'vitest';
import { Audio, type AudioOptions } from '../src/audio';
import { checkLayered, type Layered } from '../src/layers';
import { peak, rms } from '../src/loudness';
import { DEFAULT_PATCH, type Patch } from '../src/patch';
import { rmsOfDifference, seeded } from './helpers';

const SR = 48000;
const NO_REVERB = { seconds: 0.1, decay: 3, send: 0 };
// Noise, so each take is another sound; quiet and short, so the compressor leaves it straight and a take is half a second.
const NOISY: Layered = {
  volume: 0.2,
  layers: [{ kind: 'noise', at: 0, gain: 1, f: 3000, attack: 0.001, sustain: 0.1, decay: 0.05, length: 0.4 }],
};
// A steady hum that is the same every take, lasting a third of a second: what a loop is made of.
const HUM: Layered = {
  volume: 0.2,
  layers: [{ kind: 'tone', at: 0, gain: 1, f: 440, attack: 0, sustain: 0.3, decay: 0.01, length: 0.3 }],
};

interface Rendered {
  audio: Audio;
  context: OfflineAudioContext;
}
function make(options: Partial<AudioOptions> = {}, seconds = 4, seed = 1): Rendered {
  const context = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const audio = new Audio({ context, random: seeded(seed), reverb: NO_REVERB, ...options });
  return { audio, context };
}
async function rendered(
  setup: (audio: Audio) => void,
  options: Partial<AudioOptions> = {},
  seconds = 4,
  seed = 1,
): Promise<Float32Array> {
  const { audio, context } = make(options, seconds, seed);
  setup(audio);
  return (await context.startRendering()).getChannelData(0);
}
const slice = (s: Float32Array, from: number, to: number): Float32Array =>
  s.subarray(Math.round(from * SR), Math.round(to * SR));

describe('load of a layered sound', () => {
  it('keeps a layered sound under a name and plays it', async () => {
    const out = await rendered((a) => {
      a.load('noisy', NOISY);
      a.play('noisy');
    });
    expect(peak(out)).toBeGreaterThan(0.15);
    expect(peak(out)).toBeLessThan(0.21);
    expect(peak(slice(out, 0.6, 4))).toBe(0);
  });

  it('refuses a bad layered sound by the path of its field, and keeps nothing of it', () => {
    const { audio } = make();
    const bad = { ...NOISY, layers: [{ ...NOISY.layers[0], q: 0 }] };
    expect(checkLayered(bad)).toContain('layers[0].q');
    expect(() => audio.load('bad', bad)).toThrow(/Audio\.load "bad": layers\[0\]\.q/);
    expect(() => audio.play('bad')).toThrow(/no sound named "bad"/);
  });

  it("refuses a tone past the context's Nyquist, by path", () => {
    const { audio } = make();
    const high: Layered = { volume: 0.5, layers: [{ kind: 'tone', at: 0, gain: 1, f: 30000, decay: 0.1 }] };
    expect(() => audio.load('high', high)).toThrow(/Audio\.load "high": .*layers\[0\]\.f/);
  });

  it('plays a single take the same each time by default', async () => {
    // from the second second on: a context's very first voice is a sample late, which has nothing to do with the take
    const out = await rendered((a) => {
      a.load('noisy', NOISY);
      for (const at of [1, 2, 3]) a.play('noisy', { at });
    });
    expect(rmsOfDifference(slice(out, 1, 1.5), slice(out, 2, 2.5))).toBeLessThan(1e-6);
    expect(rmsOfDifference(slice(out, 1, 1.5), slice(out, 3, 3.5))).toBeLessThan(1e-6);
  });

  it('plays round its variants, so a repeat is not the same sound twice', async () => {
    const out = await rendered(
      (a) => {
        a.load('noisy', NOISY, { variants: 3 });
        for (const at of [1, 2, 3, 4]) a.play('noisy', { at });
      },
      {},
      6,
    );
    const take = (k: number): Float32Array => slice(out, k + 1, k + 1.5);
    // each of the three is another sound ...
    expect(rmsOfDifference(take(0), take(1))).toBeGreaterThan(0.01);
    expect(rmsOfDifference(take(1), take(2))).toBeGreaterThan(0.01);
    expect(rmsOfDifference(take(0), take(2))).toBeGreaterThan(0.01);
    // ... and the fourth play is the first again
    expect(rmsOfDifference(take(0), take(3))).toBeLessThan(1e-6);
  });

  it('takes variants of a patch too', async () => {
    const jittery: Patch = {
      ...DEFAULT_PATCH,
      wave: 'noise',
      frequency: 800,
      sustain: 0.1,
      release: 0.1,
      jitter: 0.5,
      volume: 0.2,
    };
    const out = await rendered((a) => {
      a.load('p', jittery, { variants: 2 });
      for (const at of [1, 2, 3]) a.play('p', { at });
    });
    expect(rmsOfDifference(slice(out, 1, 1.3), slice(out, 2, 2.3))).toBeGreaterThan(0.01);
    expect(rmsOfDifference(slice(out, 1, 1.3), slice(out, 3, 3.3))).toBeLessThan(1e-6);
  });

  it('draws its variants from the seeded source: the same seed gives the same takes, another seed others', async () => {
    const run = (seed: number): Promise<Float32Array> =>
      rendered(
        (a) => {
          a.load('noisy', NOISY, { variants: 2 });
          a.play('noisy', { at: 0 });
          a.play('noisy', { at: 1 });
        },
        {},
        3,
        seed,
      );
    const a = await run(5);
    expect(Array.from(await run(5))).toEqual(Array.from(a));
    expect(Array.from(await run(6))).not.toEqual(Array.from(a));
  });

  it('refuses variants of 0, below 0, not whole or not a number, by name', () => {
    const { audio } = make();
    for (const variants of [0, -1, 1.5, NaN, Infinity, 33])
      expect(() => audio.load('x', NOISY, { variants }), String(variants)).toThrow(
        /Audio\.load "x": variants must be a whole number from 1 to/,
      );
  });

  it('starts the round again when a name is loaded again', async () => {
    const out = await rendered((a) => {
      a.load('n', NOISY, { variants: 2 });
      a.play('n', { at: 0 });
      a.load('n', NOISY, { variants: 2 });
      a.play('n', { at: 1 });
    });
    // the second load draws other takes, but its first play is its first take: nothing to compare but that it sounds
    expect(peak(slice(out, 1, 1.5))).toBeGreaterThan(0.15);
  });
});

describe('loop', () => {
  it('plays a sound over and over, past the length of its buffer', async () => {
    const out = await rendered((a) => {
      a.load('hum', HUM);
      a.loop('hum');
    });
    // the hum lasts 0.3 s, and it is still going a second and a half in
    expect(rms(slice(out, 1.5, 1.8))).toBeGreaterThan(0.05);
    expect(rms(slice(out, 3.5, 3.9))).toBeGreaterThan(0.05);
  });

  it('does not count among the voices, so a burst of effects does not cut it', async () => {
    const { audio, context } = make({ capacity: 2 });
    audio.load('hum', HUM);
    audio.load('noisy', NOISY);
    const handle = audio.loop('hum');
    expect(audio.voices).toBe(0);
    for (let i = 0; i < 5; i++) audio.play('noisy');
    expect(audio.voices).toBe(2);
    expect(handle.playing).toBe(true);
    const out = (await context.startRendering()).getChannelData(0);
    expect(rms(slice(out, 3, 3.5))).toBeGreaterThan(0.05);
  });

  it('counts the loops it has, and a loop that is stopped leaves the count', () => {
    const { audio } = make();
    audio.load('hum', HUM);
    expect(audio.loops).toBe(0);
    const a = audio.loop('hum');
    const b = audio.loop('hum');
    expect(audio.loops).toBe(2);
    a.stop();
    expect(audio.loops).toBe(1);
    expect(a.playing).toBe(false);
    expect(b.playing).toBe(true);
  });

  it('stops: silent after stop() is called at a time, and stopping twice is harmless', async () => {
    const { audio, context } = make();
    audio.load('hum', HUM);
    const handle = audio.loop('hum');
    const stop = context.suspend(1);
    const rendering = context.startRendering();
    await stop;
    handle.stop();
    handle.stop();
    await context.resume();
    const out = (await rendering).getChannelData(0);
    expect(rms(slice(out, 0.5, 0.9))).toBeGreaterThan(0.05);
    expect(peak(slice(out, 1.1, 4))).toBe(0);
    expect(handle.playing).toBe(false);
  });

  it('has a gain it can set at any time, heard from then on', async () => {
    const { audio, context } = make();
    audio.load('hum', HUM);
    const handle = audio.loop('hum', { gain: 0.5 });
    expect(handle.gain).toBe(0.5);
    const stop = context.suspend(1);
    const rendering = context.startRendering();
    await stop;
    handle.gain = 0.25;
    expect(handle.gain).toBe(0.25);
    await context.resume();
    const out = (await rendering).getChannelData(0);
    expect(rms(slice(out, 1.1, 1.9)) / rms(slice(out, 0.1, 0.9))).toBeCloseTo(0.5, 1);
  });

  it('is silent at a gain of 0 and comes back', async () => {
    const { audio, context } = make();
    audio.load('hum', HUM);
    const handle = audio.loop('hum', { gain: 0 });
    const first = context.suspend(1);
    const second = context.suspend(2);
    const rendering = context.startRendering();
    await first;
    handle.gain = 1;
    await context.resume();
    await second;
    await context.resume();
    const out = (await rendering).getChannelData(0);
    expect(peak(slice(out, 0.1, 0.9))).toBe(0);
    expect(rms(slice(out, 1.5, 1.9))).toBeGreaterThan(0.05);
  });

  it('refuses a gain that is not 0 or more, by name, in the options and the setter', () => {
    const { audio } = make();
    audio.load('hum', HUM);
    for (const gain of [-1, NaN, Infinity])
      expect(() => audio.loop('hum', { gain }), String(gain)).toThrow(/Audio\.loop: gain must be 0 or more/);
    const handle = audio.loop('hum');
    expect(() => (handle.gain = -1)).toThrow(/gain must be 0 or more/);
    expect(handle.gain).toBe(1);
  });

  it('refuses an unknown name, by name', () => {
    const { audio } = make();
    expect(() => audio.loop('nope')).toThrow(/Audio\.loop: no sound named "nope"/);
  });

  it('follows the volume and the mute, as a played sound does', async () => {
    const half = await rendered(
      (a) => {
        a.load('hum', HUM);
        a.loop('hum');
      },
      { volume: 0.5 },
    );
    const full = await rendered((a) => {
      a.load('hum', HUM);
      a.loop('hum');
    });
    expect(rms(slice(half, 1, 1.5)) / rms(slice(full, 1, 1.5))).toBeCloseTo(0.5, 2);
    const muted = await rendered(
      (a) => {
        a.load('hum', HUM);
        a.loop('hum');
      },
      { muted: true },
    );
    expect(peak(muted)).toBe(0);
  });

  it('is cut when the Audio is disposed, and its handle is then harmless', () => {
    const { audio } = make();
    audio.load('hum', HUM);
    const handle = audio.loop('hum');
    audio.dispose();
    expect(handle.playing).toBe(false);
    expect(() => handle.stop()).not.toThrow();
    expect(() => (handle.gain = 0.5)).not.toThrow();
    expect(() => audio.loop('hum')).toThrow(/Audio\.loop: this Audio is disposed/);
  });

  it('uses the first take of a sound loaded with variants', async () => {
    const out = await rendered((a) => {
      a.load('n', NOISY, { variants: 3 });
      a.loop('n');
    });
    // the loop of a 0.4 s noise comes round, and is the first take each time, not the next: the third pass is the first
    // again, a sample or so later for the engine's own reasons, so the passes are compared from the second on
    expect(rmsOfDifference(slice(out, 0.8, 1.2), slice(out, 1.6, 2.0))).toBeLessThan(1e-6);
  });
});

describe('a loop on a real AudioContext', () => {
  it('is inert before the context runs, and plays nothing', async () => {
    const context = new AudioContext({ sampleRate: SR });
    await context.suspend();
    const audio = new Audio({ context, random: seeded(1), reverb: NO_REVERB });
    audio.load('hum', HUM);
    const handle = audio.loop('hum');
    expect(handle.playing).toBe(false);
    expect(audio.loops).toBe(0);
    expect(() => handle.stop()).not.toThrow();
    expect(() => (handle.gain = 0.3)).not.toThrow();
    audio.dispose();
    await context.close();
  });
});
