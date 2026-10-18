// An ambience: the sound a place has that no one event makes. A bed that loops (wind in the grass, a room's hum) whose
// level follows an intensity, and calls (a bird, a far-off bell) played now and then at a seeded random rate. Like the
// player it is stepped by game time, so a paused game is silent and the ambience waits, and it reads no clock: the
// bed's fade and the wait for the next call are both sums over the `dt` it is given.
//
// It asks an Audio for two things, `loop` for the bed and `play` for a call, and nothing else, so under node a test
// puts a record-keeper in the place of the Audio and reads every sum off it. The sounds are loaded by the game, the
// bed with `{ loop: seconds }` so that it comes round without a seam; the ambience is handed their names.

import type { Audio } from './audio';

/** What the ambience uses of an Audio. */
export type AmbienceOutput = Pick<Audio, 'play' | 'loop'>;

export interface AmbienceOptions {
  random: () => number; // the calls' choice, pan and wait; required, so that the same seed gives the same calls
  bed?: string; // the name of a sound loaded with `{ loop }`; none if absent
  calls?: readonly string[]; // names of the sounds a call is drawn from; none if absent
  interval?: readonly [number, number]; // the wait between calls in seconds, between these, default [4, 12]
  callGain?: number; // 0 or more, default 1
  pan?: number; // 0 to 1: a call is placed anywhere within this of the middle, default 0.8
  fade?: number; // seconds the bed takes to go from nothing to full or back, above 0, default 1
}

export const DEFAULT_INTERVAL: readonly [number, number] = [4, 12];

const fail = (what: string): never => {
  throw new Error(`Ambience: ${what}`);
};

export class Ambience {
  private readonly audio: AmbienceOutput;
  private readonly random: () => number;
  private readonly bed: string | undefined;
  private readonly calls: readonly string[];
  private readonly interval: readonly [number, number];
  private readonly callGain: number;
  private readonly spread: number;
  private readonly fade: number;
  private target = 0;
  // Where the bed's level is now, on its way to the target.
  private level = 0;
  private running = false;
  private handle: ReturnType<AmbienceOutput['loop']> | null = null;
  // Game seconds to the next call, or null before the first step has drawn it.
  private wait: number | null = null;

  constructor(audio: AmbienceOutput, options: AmbienceOptions) {
    this.audio = audio;
    this.random = options.random;
    this.bed = options.bed;
    this.calls = options.calls ?? [];
    this.interval = options.interval ?? DEFAULT_INTERVAL;
    this.callGain = options.callGain ?? 1;
    this.spread = options.pan ?? 0.8;
    this.fade = options.fade ?? 1;
    if (typeof this.random !== 'function') fail('random must be a function');
    if (this.bed !== undefined && typeof this.bed !== 'string')
      fail(`bed must be a sound's name, got ${String(this.bed)}`);
    if (!Array.isArray(this.calls) || this.calls.some((name) => typeof name !== 'string'))
      fail('calls must be a list of sound names');
    const [low, high] = Array.isArray(this.interval) ? (this.interval as [number, number]) : [NaN, NaN];
    if (!(Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low))
      fail(
        `interval must be two seconds from above 0, the second not under the first, got ${JSON.stringify(this.interval)}`,
      );
    if (!Number.isFinite(this.callGain) || this.callGain < 0) fail(`callGain must be 0 or more, got ${this.callGain}`);
    if (!Number.isFinite(this.spread) || this.spread < 0 || this.spread > 1)
      fail(`pan must be from 0 to 1, got ${this.spread}`);
    if (!Number.isFinite(this.fade) || this.fade <= 0) fail(`fade must be above 0 seconds, got ${this.fade}`);
  }

  // How loud the bed is to be, 0 to 1; the level follows it over `fade`. Set whenever a game likes, a wind that changes
  // with the hole for one.
  get intensity(): number {
    return this.target;
  }

  set intensity(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) fail(`intensity must be from 0 to 1, got ${value}`);
    this.target = value;
  }

  // Starts the ambience: from the next step the bed rises from nothing and the calls begin. Starting twice is harmless.
  start(): void {
    this.running = true;
  }

  // Stops it at once: the bed is cut and the calls cease, and a later start begins from silence. The wait to the next
  // call is kept, so a stop and a start do not make a call come sooner. Stopping twice is harmless.
  stop(): void {
    this.running = false;
    this.endBed();
    this.level = 0;
  }

  // Moves the ambience on by `dt` seconds of game time. A step of nothing changes nothing. A step of a long time (a tab
  // that slept) moves the bed's level to its target but plays one call at most, and not the calls it jumped over.
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error(`Ambience.step: dt must be a number of seconds from 0, got ${dt}`);
    if (!this.running || dt === 0) return;
    this.stepBed(dt);
    this.stepCalls(dt);
  }

  private stepBed(dt: number): void {
    if (this.bed === undefined) return;
    const move = dt / this.fade;
    this.level =
      this.level < this.target ? Math.min(this.target, this.level + move) : Math.max(this.target, this.level - move);
    // A bed at nothing and going nowhere is stopped, and made again when it rises: a loop that is silent still costs.
    if (this.level === 0 && this.target === 0) return this.endBed();
    if (this.handle === null || !this.handle.playing) {
      this.handle = this.audio.loop(this.bed, { gain: this.level });
      return;
    }
    if (this.handle.gain !== this.level) this.handle.gain = this.level;
  }

  private stepCalls(dt: number): void {
    if (this.calls.length === 0) return;
    this.wait ??= this.drawWait();
    this.wait -= dt;
    if (this.wait > 0) return;
    const name = this.calls[Math.floor(this.random() * this.calls.length)];
    this.audio.play(name, { gain: this.callGain, pan: this.spread * (2 * this.random() - 1) });
    this.wait = this.drawWait();
  }

  private drawWait(): number {
    return this.interval[0] + (this.interval[1] - this.interval[0]) * this.random();
  }

  private endBed(): void {
    this.handle?.stop();
    this.handle = null;
  }
}
