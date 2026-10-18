// The arithmetic behind the player, held under node: beat to audio time, and the window of beats a step schedules.
// The player itself needs a Web Audio context and is tested in test/player.audio.test.ts; what is here is every
// number that player works out, so that a wrong sum is found in milliseconds and not in a browser.

import { describe, expect, it } from 'vitest';
import { audioTime, beatsIn, scheduleWindow } from '../src/schedule';
import { notes } from '../src/song';
import { calm } from '../src/songs';

describe('beatsIn', () => {
  it('turns seconds into beats at the tempo', () => {
    expect(beatsIn(0.1, 90)).toBeCloseTo(0.15, 12);
    expect(beatsIn(60, 120)).toBe(120);
    expect(beatsIn(0, 90)).toBe(0);
  });
});

describe('audioTime', () => {
  it('places a note ahead of the beat on the audio clock', () => {
    // One beat at 120 a minute is half a second.
    expect(audioTime(2, 1, 120, 10)).toBeCloseTo(10.5, 12);
    expect(audioTime(1, 1, 120, 10)).toBe(10);
  });

  it('plays a note that is already late at once, never in the past', () => {
    expect(audioTime(0, 0.15, 90, 3)).toBe(3);
  });
});

describe('scheduleWindow', () => {
  it('runs from where the last step stopped to the lookahead past the beat', () => {
    expect(scheduleWindow(0, 0.15, 0.15)).toEqual({ from: 0, to: 0.3 });
    expect(scheduleWindow(0.3, 0.2, 0.15)).toEqual({ from: 0.3, to: 0.35 });
  });

  it('skips what a long step jumped over, and keeps only a lookahead behind the beat', () => {
    const w = scheduleWindow(0.3, 90, 0.15);
    expect(w.from).toBeCloseTo(89.85, 9);
    expect(w.to).toBeCloseTo(90.15, 9);
  });

  it('hands every note out once across steps of any size under the lookahead', () => {
    const lookahead = beatsIn(0.1, calm.bpm);
    const heard: number[] = [];
    let upTo = 0;
    let beat = 0;
    // Steps of mixed sizes, a zero among them.
    for (const dt of [0.016, 0, 0.05, 0.033, 0.1, 0.02, 0, 0.09, 0.07]) {
      beat += beatsIn(dt, calm.bpm);
      const { from, to } = scheduleWindow(upTo, beat, lookahead);
      for (const note of notes({ ...calm, voices: [calm.voices[0]] }, from, to)) heard.push(note.beat);
      upTo = to;
    }
    expect(heard.length).toBeGreaterThan(0);
    expect(heard).toEqual([...new Set(heard)].sort((a, b) => a - b));
  });
});
