// The Web Audio side: a class over an AudioContext handed in, which holds the sounds rendered by the synth as buffers
// and plays them through a capped pool of voices, a reverb and a compressor. It is the picture of the library: all
// the sound is made in synth.ts, and this file only routes it. Without the cap a game that fires a sound per frame
// would grow the graph without end; without the compressor many voices at once would clip. It reads no clock, and
// takes its chance from the `random` it is given.
//
//   voice: BufferSource -> gain -> StereoPanner -+-> dry bus ------------------+-> DynamicsCompressor -> master -> out
//                                                 \-> send gain -> Convolver --/

import { checkPatch, type Patch } from './patch';
import { render } from './synth';
import { impulse } from './reverb';

export interface AudioOptions {
  context: BaseAudioContext; // AudioContext in a game, OfflineAudioContext in a test
  capacity?: number; // voices at once, default 16; past it the oldest is cut
  random?: () => number;
  reverb?: { seconds: number; decay: number; send: number };
  destination?: AudioNode; // where the master gain goes, default the context's destination
}

export interface PlayOptions {
  gain?: number; // 0 or more, default 1
  pitch?: number; // playback rate, above 0 and up to MAX_PITCH, default 1
  pan?: number; // -1 (left) to 1 (right), default 0
  at?: number; // audio-clock seconds to start at, default now; a little late is played at once, much later is refused
}

export const DEFAULT_CAPACITY = 16;
export const MAX_PITCH = 4;
/** How far in the past an `at` may be before it is a mistake and not a note that is a frame late, in seconds. */
export const LATE_TOLERANCE = 0.05;
export const DEFAULT_REVERB = { seconds: 0.6, decay: 4, send: 0.15 };

interface Voice {
  source: AudioBufferSourceNode;
  nodes: AudioNode[];
}

export class Audio {
  private readonly context: BaseAudioContext;
  private readonly capacity: number;
  private readonly random: () => number;
  private readonly buffers = new Map<string, AudioBuffer>();
  // Oldest first, so the one to cut is always at the front.
  private readonly playing: Voice[] = [];
  private readonly bus: GainNode;
  private readonly master: GainNode;
  private readonly graph: AudioNode[];
  private disposed = false;

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

  // Renders the patch now, at the context's sample rate, and keeps it under the name; a name loaded twice is replaced.
  // A bad patch is refused here, by the name of its field, and never reaches play.
  load(name: string, patch: Patch): void {
    this.alive('load');
    const problem = checkPatch(patch);
    if (problem !== null) throw new Error(`Audio.load "${name}": ${problem}`);
    const rate = this.context.sampleRate;
    let samples: Float32Array;
    try {
      samples = render(patch, rate, this.random);
    } catch (error) {
      throw new Error(`Audio.load "${name}": ${error instanceof Error ? error.message : String(error)}`);
    }
    const buffer = this.context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    this.buffers.set(name, buffer);
  }

  // Starts a voice now. Before the context is running (a real one waits for a gesture) it does nothing and queues
  // nothing, so a sound fired at the title screen is not heard late.
  play(name: string, options: PlayOptions = {}): void {
    this.alive('play');
    const buffer = this.buffers.get(name);
    if (buffer === undefined) throw new Error(`Audio.play: no sound named "${name}"`);
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
    source.buffer = buffer;
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

  // Starts a suspended context, on the first gesture. An offline context has nothing to start, so it is a no-op there.
  async resume(): Promise<void> {
    this.alive('resume');
    if (this.context instanceof OfflineAudioContext) return;
    await (this.context as AudioContext).resume();
  }

  mute(on: boolean): void {
    this.alive('mute');
    this.master.gain.value = on ? 0 : 1;
  }

  // Stops every voice and takes the graph apart. Every later call throws; a second dispose is harmless.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.playing.length > 0) this.release(this.playing[0]);
    for (const node of this.graph) node.disconnect();
    this.buffers.clear();
  }

  private alive(call: string): void {
    if (this.disposed) throw new Error(`Audio.${call}: this Audio is disposed`);
  }

  private running(): boolean {
    return this.context instanceof OfflineAudioContext || (this.context as AudioContext).state === 'running';
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
