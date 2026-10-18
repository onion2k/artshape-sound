// The Web Audio side: a class over an AudioContext handed in, which holds the sounds rendered by the synth as buffers
// and plays them through a capped pool of voices, a reverb and a compressor. It is the picture of the library: all
// the sound is made in synth.ts, and this file only routes it. Without the cap a game that fires a sound per frame
// would grow the graph without end; without the compressor many voices at once would clip. It reads no clock, and
// takes its chance from the `random` it is given.
//
//   voice: BufferSource -> gain -> StereoPanner -+-> dry bus ------------------+-> DynamicsCompressor -> master -> out
//                                                 \-> send gain -> Convolver --/

import { checkLayered, isLayered, renderLayered, renderLoop, type Layered } from './layers';
import { checkPatch, type Patch } from './patch';
import { render } from './synth';
import { DEFAULT_REVERB, impulse } from './reverb';

export interface AudioOptions {
  context: BaseAudioContext; // AudioContext in a game, OfflineAudioContext in a test
  capacity?: number; // voices at once, default 16; past it the oldest is cut
  random?: () => number;
  reverb?: { seconds: number; decay: number; send: number };
  destination?: AudioNode; // where the master gain goes, default the context's destination
  volume?: number; // 0 to 1, default 1; a game restores its saved setting here
  muted?: boolean; // default false; a game restores its saved setting here
}

export interface PlayOptions {
  gain?: number; // 0 or more, default 1
  pitch?: number; // playback rate, above 0 and up to MAX_PITCH, default 1
  pan?: number; // -1 (left) to 1 (right), default 0
  at?: number; // audio-clock seconds to start at, default now; a little late is played at once, much later is refused
}

export interface LoadOptions {
  variants?: number; // takes to render from the seeded source, default 1; play goes round them
  loop?: number; // seconds: render a layered sound as a loop of this length, that comes round with no seam
}

export interface LoopOptions {
  gain?: number; // 0 or more, default 1
}

/** What `Audio.loop` gives back: a way to stop the loop and to move its gain. */
export interface Loop {
  /** Stops the loop and lets go of its nodes. Stopping twice is harmless. */
  stop(): void;
  /** The loop's own level, 0 or more, apart from the master volume; set at any time and heard from then on. */
  gain: number;
  /** True while the loop sounds: false once stopped or once the Audio is disposed, and false from the start of a
   * loop asked of a context that was not running, which is silent and queues nothing, as `play` is. */
  readonly playing: boolean;
}

export const DEFAULT_CAPACITY = 16;
/** The most takes one name may hold. */
export const MAX_VARIANTS = 32;
export const MAX_PITCH = 4;
/** How far in the past an `at` may be before it is a mistake and not a note that is a frame late, in seconds. */
export const LATE_TOLERANCE = 0.05;

function checkVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    throw new Error(`Audio: volume must be from 0 to 1, got ${volume}`);
  return volume;
}

interface Voice {
  source: AudioBufferSourceNode;
  nodes: AudioNode[];
}

// A sound as loaded: its takes, and which one `play` is to use next.
interface Sound {
  takes: AudioBuffer[];
  next: number;
}

// A loop that is playing, or has been stopped, or was never started because the context was not running.
interface LoopState {
  source: AudioBufferSourceNode | null;
  level: GainNode | null;
  gain: number;
  live: boolean;
}

function checkGain(gain: number, call: string): number {
  if (!Number.isFinite(gain) || gain < 0) throw new Error(`Audio.${call}: gain must be 0 or more, got ${gain}`);
  return gain;
}

export class Audio {
  private readonly context: BaseAudioContext;
  private readonly capacity: number;
  private readonly random: () => number;
  private readonly sounds = new Map<string, Sound>();
  // The loops that are sounding; a loop leaves when it is stopped, so the set is as long as the loops are.
  private readonly looping = new Set<LoopState>();
  // Oldest first, so the one to cut is always at the front.
  private readonly playing: Voice[] = [];
  private readonly bus: GainNode;
  private readonly master: GainNode;
  private readonly graph: AudioNode[];
  private disposed = false;
  // Volume and mute are kept apart, so that unmuting brings back the volume that was set, even one set while muted.
  private level: number;
  private silenced: boolean;

  constructor(options: AudioOptions) {
    const { context } = options;
    this.context = context;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(this.capacity) || this.capacity < 1)
      throw new Error(`Audio: capacity must be a whole number from 1, got ${this.capacity}`);
    // The one fallback here to the global source, for a game that passes none; a game that passes its own seeded
    // source gets the same sound every run.
    this.random = options.random ?? Math.random;
    const reverb = options.reverb ?? DEFAULT_REVERB;

    this.bus = context.createGain();
    const send = context.createGain();
    send.gain.value = reverb.send;
    const convolver = context.createConvolver();
    // Two channels of different noise, so the room is wide. Drawn before any sound is, in a fixed order.
    const room = context.createBuffer(
      2,
      Math.max(1, Math.round(reverb.seconds * context.sampleRate)),
      context.sampleRate,
    );
    for (let c = 0; c < 2; c++)
      room.copyToChannel(
        impulse(reverb.seconds, reverb.decay, context.sampleRate, this.random) as Float32Array<ArrayBuffer>,
        c,
      );
    convolver.buffer = room;
    // A limiter more than a compressor: it leaves a single voice alone and holds a crowd of them from clipping.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 6;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.1;
    this.master = context.createGain();
    this.level = checkVolume(options.volume ?? 1);
    this.silenced = options.muted ?? false;
    // Set directly: nothing is playing yet, so there is nothing to click.
    this.master.gain.value = this.silenced ? 0 : this.level;

    this.bus.connect(compressor);
    this.bus.connect(send);
    send.connect(convolver);
    convolver.connect(compressor);
    compressor.connect(this.master);
    this.master.connect(options.destination ?? context.destination);
    this.graph = [this.bus, send, convolver, compressor, this.master];
  }

  // The audio clock, in seconds: what a time given to `play` is measured on. It stands still on an offline context
  // until it renders, and on a real one it stops while the context is suspended.
  get time(): number {
    this.alive('time');
    return this.context.currentTime;
  }

  // How many voices are playing now, for a test and a leak ceiling.
  get voices(): number {
    return this.playing.length;
  }

  // How many loops are sounding now, for a test and a leak ceiling. They are not voices: a burst of effects does not cut
  // a loop, and a loop does not use up the capacity.
  get loops(): number {
    return this.looping.size;
  }

  // Renders the sound now, at the context's sample rate, and keeps it under the name; a name loaded twice is replaced.
  // A sound is a patch or a layered sound, and `variants` renders that many takes from the seeded source, so that
  // `play` can go round them and a repeat is not the same sound twice. A bad sound is refused here, by the name of
  // its field, and never reaches play.
  load(name: string, sound: Patch | Layered, options: LoadOptions = {}): void {
    this.alive('load');
    const variants = options.variants ?? 1;
    if (!Number.isInteger(variants) || variants < 1 || variants > MAX_VARIANTS)
      throw new Error(
        `Audio.load "${name}": variants must be a whole number from 1 to ${MAX_VARIANTS}, got ${variants}`,
      );
    const layered = isLayered(sound);
    const problem = layered ? checkLayered(sound) : checkPatch(sound);
    if (problem !== null) throw new Error(`Audio.load "${name}": ${problem}`);
    const { loop } = options;
    if (loop !== undefined && !layered)
      throw new Error(`Audio.load "${name}": loop needs a layered sound, got a patch`);
    const rate = this.context.sampleRate;
    const takes: AudioBuffer[] = [];
    try {
      for (let k = 0; k < variants; k++) {
        let samples: Float32Array;
        if (!isLayered(sound)) samples = render(sound, rate, this.random);
        else if (loop !== undefined) samples = renderLoop(sound, loop, rate, this.random);
        else samples = renderLayered(sound, rate, this.random);
        const buffer = this.context.createBuffer(1, samples.length, rate);
        buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
        takes.push(buffer);
      }
    } catch (error) {
      throw new Error(`Audio.load "${name}": ${error instanceof Error ? error.message : String(error)}`);
    }
    this.sounds.set(name, { takes, next: 0 });
  }

  // Starts a voice now. Before the context is running (a real one waits for a gesture) it does nothing and queues
  // nothing, so a sound fired at the title screen is not heard late.
  play(name: string, options: PlayOptions = {}): void {
    this.alive('play');
    const sound = this.sounds.get(name);
    if (sound === undefined) throw new Error(`Audio.play: no sound named "${name}"`);
    const { gain = 1, pitch = 1, pan = 0 } = options;
    if (!Number.isFinite(pitch) || pitch <= 0 || pitch > MAX_PITCH)
      throw new Error(`Audio.play: pitch must be above 0 and up to ${MAX_PITCH}, got ${pitch}`);
    if (!Number.isFinite(pan) || pan < -1 || pan > 1)
      throw new Error(`Audio.play: pan must be from -1 to 1, got ${pan}`);
    if (!Number.isFinite(gain) || gain < 0) throw new Error(`Audio.play: gain must be 0 or more, got ${gain}`);
    const { at } = options;
    if (at !== undefined) {
      if (!Number.isFinite(at)) throw new Error(`Audio.play: at must be a finite time in seconds, got ${at}`);
      // A note a frame late is the player's rounding and plays at once; one far in the past is a caller that has
      // mixed up the audio clock with its own, and is refused so that the mix-up is seen.
      if (at < this.context.currentTime - LATE_TOLERANCE)
        throw new Error(`Audio.play: at ${at} is in the past, the audio clock being at ${this.context.currentTime}`);
    }
    if (!this.running()) return;

    while (this.playing.length >= this.capacity) this.release(this.playing[0]);

    const source = this.context.createBufferSource();
    source.buffer = sound.takes[sound.next % sound.takes.length];
    sound.next = (sound.next + 1) % sound.takes.length;
    source.playbackRate.value = pitch;
    const level = this.context.createGain();
    level.gain.value = gain;
    const panner = this.context.createStereoPanner();
    panner.pan.value = pan;
    source.connect(level).connect(panner).connect(this.bus);
    const voice: Voice = { source, nodes: [source, level, panner] };
    source.onended = () => this.release(voice);
    this.playing.push(voice);
    if (at === undefined) source.start();
    else source.start(Math.max(at, 0)); // a time before 0 is a time that has passed, and start refuses it
  }

  // Plays the first take of a sound over and over until it is stopped, and gives back a handle to stop it or move its
  // gain. A loop is a bed (wind, a room) and not a voice: it is outside the capacity and is never the oldest to be cut.
  // On a context that is not running it does nothing and queues nothing, as `play` does, and the handle it gives is a
  // loop that is not playing, so a caller that asks again once the context runs gets a real one.
  loop(name: string, options: LoopOptions = {}): Loop {
    this.alive('loop');
    const sound = this.sounds.get(name);
    if (sound === undefined) throw new Error(`Audio.loop: no sound named "${name}"`);
    const state: LoopState = { source: null, level: null, gain: checkGain(options.gain ?? 1, 'loop'), live: false };
    if (this.running()) {
      const source = this.context.createBufferSource();
      source.buffer = sound.takes[0];
      source.loop = true;
      const level = this.context.createGain();
      level.gain.value = state.gain;
      source.connect(level).connect(this.bus);
      source.start();
      state.source = source;
      state.level = level;
      state.live = true;
      this.looping.add(state);
    }
    const now = (): number => this.context.currentTime;
    return {
      stop: () => this.endLoop(state),
      get gain() {
        return state.gain;
      },
      set gain(value: number) {
        state.gain = checkGain(value, 'loop');
        // Set as the master's is, with a step at the context's time, so an offline context reads it as it renders.
        state.level?.gain.setValueAtTime(state.gain, now());
      },
      get playing() {
        return state.live;
      },
    };
  }

  // Starts a suspended context, on the first gesture. An offline context has nothing to start, so it is a no-op there.
  async resume(): Promise<void> {
    this.alive('resume');
    if (this.context instanceof OfflineAudioContext) return;
    await (this.context as AudioContext).resume();
  }

  // The master volume, 0 to 1, whether or not it is muted. 0 is silence but is not muted.
  get volume(): number {
    this.alive('volume');
    return this.level;
  }

  set volume(value: number) {
    this.alive('volume');
    this.level = checkVolume(value);
    this.applyMaster();
  }

  get muted(): boolean {
    this.alive('muted');
    return this.silenced;
  }

  // Silences the master whatever the volume, and unmuting brings the volume back. Either twice is harmless.
  mute(on: boolean): void {
    this.alive('mute');
    this.silenced = on;
    this.applyMaster();
  }

  // Stops every voice and takes the graph apart. Every later call throws; a second dispose is harmless.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.playing.length > 0) this.release(this.playing[0]);
    for (const state of [...this.looping]) this.endLoop(state);
    for (const node of this.graph) node.disconnect();
    this.sounds.clear();
  }

  private alive(call: string): void {
    if (this.disposed) throw new Error(`Audio.${call}: this Audio is disposed`);
  }

  // Sets the master gain with setValueAtTime at the context's time, and not setTargetAtTime. An offline context's clock
  // stands still until it renders, so a smoothed change would still be sliding when a test reads it and mute would
  // never be exactly silent; a step lands the same on any context. The cost is a possible click on a live change,
  // which is a person moving a slider or a button, not a sound already playing at full level.
  private applyMaster(): void {
    this.master.gain.setValueAtTime(this.silenced ? 0 : this.level, this.context.currentTime);
  }

  private running(): boolean {
    return this.context instanceof OfflineAudioContext || (this.context as AudioContext).state === 'running';
  }

  // Stops a loop and lets go of its nodes. Safe to call more than once, and after dispose.
  private endLoop(state: LoopState): void {
    if (!state.live) return;
    state.live = false;
    this.looping.delete(state);
    try {
      state.source?.stop();
    } catch {
      // A source that has already stopped throws on stop, and there is nothing left to stop.
    }
    state.source?.disconnect();
    state.level?.disconnect();
    state.source = null;
    state.level = null;
  }

  // Takes a voice out of the count, stops it and lets go of its nodes. Safe to call more than once, as a cut voice
  // still sends its ended event.
  private release(voice: Voice): void {
    const at = this.playing.indexOf(voice);
    if (at < 0) return;
    this.playing.splice(at, 1);
    voice.source.onended = null;
    try {
      voice.source.stop();
    } catch {
      // A source that has already finished throws on stop, and there is nothing left to stop.
    }
    for (const node of voice.nodes) node.disconnect();
  }
}
