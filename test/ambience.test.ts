// The ambience under node, with a fake in the place of Audio: a bed whose level follows an intensity, and calls played
// at a seeded random rate, all stepped by game time. A fake records what the ambience asks for, so every sum (when a
// call falls, how fast the bed follows) is read off the record and no clock is waited on.
import { describe, expect, it } from 'vitest';
import { Ambience, type AmbienceOutput } from '../src/ambience';
import type { Loop, PlayOptions } from '../src/audio';
import { seeded } from './helpers';

class FakeLoop implements Loop {
  playing = true;
  sets: number[] = [];
  private level: number;
  constructor(
    readonly name: string,
    gain: number,
  ) {
    this.level = gain;
  }
  get gain(): number {
    return this.level;
  }
  set gain(value: number) {
    this.level = value;
    this.sets.push(value);
  }
  stop(): void {
    this.playing = false;
  }
}
class Fake implements AmbienceOutput {
  plays: { name: string; options: PlayOptions }[] = [];
  loops: FakeLoop[] = [];
  play(name: string, options: PlayOptions = {}): void {
    this.plays.push({ name, options });
  }
  loop(name: string, options: { gain?: number } = {}): FakeLoop {
    const loop = new FakeLoop(name, options.gain ?? 1);
    this.loops.push(loop);
    return loop;
  }
}
const make = (more: object = {}, seed = 1): { fake: Fake; ambience: Ambience } => {
  const fake = new Fake();
  return { fake, ambience: new Ambience(fake, { bed: 'wind', calls: ['a', 'b', 'c'], random: seeded(seed), ...more }) };
};
const run = (a: Ambience, seconds: number, dt = 0.1): void => {
  for (let t = 0; t < seconds - 1e-9; t += dt) a.step(dt);
};

describe('an ambience that is not stepped', () => {
  it('plays nothing and makes no loop, however it is started', () => {
    const { fake, ambience } = make();
    ambience.intensity = 1;
    ambience.start();
    expect(fake.plays).toEqual([]);
    expect(fake.loops).toEqual([]);
  });

  it('plays nothing when stepped before it is started', () => {
    const { fake, ambience } = make();
    ambience.intensity = 1;
    run(ambience, 30);
    expect(fake.plays).toEqual([]);
    expect(fake.loops).toEqual([]);
  });

  it('adds nothing for a step of nothing', () => {
    const { fake, ambience } = make({ interval: [1, 1] });
    ambience.intensity = 1;
    ambience.start();
    for (let i = 0; i < 50; i++) ambience.step(0);
    expect(fake.plays).toEqual([]);
    expect(fake.loops).toEqual([]);
  });
});

describe('the bed', () => {
  it('has no loop while the intensity is 0, and starts one at 0 when it rises', () => {
    const { fake, ambience } = make({ calls: [] });
    ambience.start();
    run(ambience, 3);
    expect(fake.loops).toEqual([]);
    ambience.intensity = 1;
    ambience.step(0.1);
    expect(fake.loops).toHaveLength(1);
    expect(fake.loops[0].name).toBe('wind');
    expect(fake.loops[0].gain).toBeCloseTo(0.1, 12);
  });

  it('follows the intensity at a rate of one a fade, up and down', () => {
    const { fake, ambience } = make({ calls: [], fade: 2 });
    ambience.intensity = 1;
    ambience.start();
    ambience.step(1);
    expect(fake.loops[0].gain).toBeCloseTo(0.5, 12);
    ambience.step(1);
    expect(fake.loops[0].gain).toBeCloseTo(1, 12);
    ambience.step(5);
    expect(fake.loops[0].gain).toBe(1);
    ambience.intensity = 0.25;
    ambience.step(1);
    expect(fake.loops[0].gain).toBeCloseTo(0.5, 12);
    ambience.step(1);
    expect(fake.loops[0].gain).toBeCloseTo(0.25, 12);
    ambience.step(10);
    expect(fake.loops[0].gain).toBeCloseTo(0.25, 12);
  });

  it('settles on the intensity exactly and then writes the gain no more', () => {
    const { fake, ambience } = make({ calls: [] });
    ambience.intensity = 0.6;
    ambience.start();
    run(ambience, 5);
    const sets = fake.loops[0].sets.length;
    expect(fake.loops[0].gain).toBe(0.6);
    run(ambience, 20);
    expect(fake.loops[0].sets).toHaveLength(sets);
  });

  it('is stopped, and not left sounding at 0, once the intensity is 0 and the level has fallen to it', () => {
    const { fake, ambience } = make({ calls: [] });
    ambience.intensity = 1;
    ambience.start();
    run(ambience, 3);
    ambience.intensity = 0;
    run(ambience, 3);
    expect(fake.loops[0].playing).toBe(false);
    ambience.intensity = 0.5;
    ambience.step(0.1);
    expect(fake.loops).toHaveLength(2);
    expect(fake.loops[1].playing).toBe(true);
  });

  it('is made again if its loop has died, as one asked of a context that was not running is', () => {
    const { fake, ambience } = make({ calls: [] });
    ambience.intensity = 1;
    ambience.start();
    ambience.step(0.1);
    fake.loops[0].playing = false;
    ambience.step(0.1);
    expect(fake.loops).toHaveLength(2);
  });

  it('stops with stop(), and starts again from silence', () => {
    const { fake, ambience } = make({ calls: [] });
    ambience.intensity = 1;
    ambience.start();
    run(ambience, 3);
    expect(fake.loops[0].gain).toBe(1);
    ambience.stop();
    expect(fake.loops[0].playing).toBe(false);
    run(ambience, 3);
    expect(fake.loops).toHaveLength(1);
    ambience.start();
    ambience.step(0.1);
    expect(fake.loops[1].gain).toBeCloseTo(0.1, 12);
  });

  it('is harmless to start twice or stop twice', () => {
    const { fake, ambience } = make({ calls: [] });
    ambience.stop();
    ambience.intensity = 1;
    ambience.start();
    ambience.start();
    ambience.step(0.1);
    expect(fake.loops).toHaveLength(1);
    ambience.stop();
    ambience.stop();
    expect(fake.loops[0].playing).toBe(false);
  });

  it('is absent when there is no bed, and the calls go on', () => {
    const { fake, ambience } = make({ bed: undefined, interval: [1, 1] });
    ambience.intensity = 1;
    ambience.start();
    run(ambience, 5.5);
    expect(fake.loops).toEqual([]);
    expect(fake.plays.length).toBeGreaterThan(2);
  });
});

describe('the calls', () => {
  it('fall at the interval: one a second and a half, for a wait of exactly that', () => {
    const { fake, ambience } = make({ interval: [1.5, 1.5], bed: undefined });
    ambience.start();
    run(ambience, 7.4, 0.05);
    expect(fake.plays).toHaveLength(4);
  });

  it('wait between the two ends of the interval, drawn from the seed', () => {
    const { fake, ambience } = make({ interval: [2, 6], bed: undefined });
    ambience.start();
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 3000; i++) {
      const before = fake.plays.length;
      ambience.step(0.1);
      t += 0.1;
      if (fake.plays.length > before) times.push(t);
    }
    expect(times.length).toBeGreaterThan(40);
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(gap).toBeLessThanOrEqual(6.1);
    }
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(2);
  });

  it('repeat from a seed, and differ from another', () => {
    const sequence = (seed: number): string => {
      const { fake, ambience } = make({ bed: undefined }, seed);
      ambience.start();
      run(ambience, 300);
      return JSON.stringify(fake.plays);
    };
    expect(sequence(7)).toBe(sequence(7));
    expect(sequence(7)).not.toBe(sequence(8));
  });

  it('are drawn from the list, every name of it in the end, at a pan within the spread and the gain asked', () => {
    const { fake, ambience } = make({ bed: undefined, interval: [0.5, 1], pan: 0.6, callGain: 0.4 });
    ambience.start();
    run(ambience, 400);
    expect(new Set(fake.plays.map((p) => p.name))).toEqual(new Set(['a', 'b', 'c']));
    for (const p of fake.plays) {
      expect(Math.abs(p.options.pan ?? 99)).toBeLessThanOrEqual(0.6);
      expect(p.options.gain).toBe(0.4);
    }
    expect(Math.min(...fake.plays.map((p) => p.options.pan ?? 0))).toBeLessThan(-0.3);
    expect(Math.max(...fake.plays.map((p) => p.options.pan ?? 0))).toBeGreaterThan(0.3);
  });

  it('are only played while it is started, and the wait is kept across a stop', () => {
    const { fake, ambience } = make({ bed: undefined, interval: [1, 1] });
    run(ambience, 5);
    expect(fake.plays).toEqual([]);
    ambience.start();
    run(ambience, 3.5);
    const n = fake.plays.length;
    expect(n).toBe(3);
    ambience.stop();
    run(ambience, 10);
    expect(fake.plays).toHaveLength(n);
  });

  it('are at most one a step, and a long step does not play the calls it jumped over', () => {
    const { fake, ambience } = make({ bed: undefined, interval: [1, 1] });
    ambience.start();
    ambience.step(1000);
    expect(fake.plays).toHaveLength(1);
    ambience.step(0.5);
    expect(fake.plays).toHaveLength(1);
  });

  it('are not made when the list is empty', () => {
    const { fake, ambience } = make({ calls: [], bed: undefined });
    ambience.start();
    run(ambience, 100);
    expect(fake.plays).toEqual([]);
  });

  it('do not depend on the intensity: a hole with no wind still has its birds', () => {
    const { fake, ambience } = make({ bed: undefined, interval: [1, 1] });
    ambience.intensity = 0;
    ambience.start();
    run(ambience, 5.5);
    expect(fake.plays.length).toBeGreaterThan(3);
  });
});

describe('what the ambience refuses, by name', () => {
  it('a bad intensity, and keeps the old one', () => {
    const { ambience } = make();
    ambience.intensity = 0.3;
    for (const v of [-0.1, 1.1, NaN, Infinity])
      expect(() => (ambience.intensity = v), String(v)).toThrow(/Ambience: intensity must be from 0 to 1/);
    expect(ambience.intensity).toBe(0.3);
  });

  it('a bad step', () => {
    const { ambience } = make();
    for (const v of [-1, NaN, Infinity])
      expect(() => ambience.step(v), String(v)).toThrow(/Ambience\.step: dt must be/);
  });

  it('bad options', () => {
    const fake = new Fake();
    const random = seeded(1);
    const bad =
      (more: object): unknown =>
      () =>
        new Ambience(fake, { random, ...more });
    expect(bad({ interval: [0, 3] })).toThrow(/Ambience: interval/);
    expect(bad({ interval: [5, 3] })).toThrow(/Ambience: interval/);
    expect(bad({ interval: [1, NaN] })).toThrow(/Ambience: interval/);
    expect(bad({ interval: 3 })).toThrow(/Ambience: interval/);
    expect(bad({ fade: 0 })).toThrow(/Ambience: fade/);
    expect(bad({ callGain: -1 })).toThrow(/Ambience: callGain/);
    expect(bad({ pan: 2 })).toThrow(/Ambience: pan/);
    expect(bad({ calls: [1] })).toThrow(/Ambience: calls/);
    expect(bad({ calls: 'a' })).toThrow(/Ambience: calls/);
    expect(bad({ bed: 3 })).toThrow(/Ambience: bed/);
  });
});
