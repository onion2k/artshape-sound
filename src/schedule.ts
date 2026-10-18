// The arithmetic of the player, kept apart from it so that it runs under node: how far a beat is ahead on the audio
// clock, and which stretch of beats a step has to hand out. All of it is pure and reads no clock; the player passes the
// audio clock's reading in. Without it the sums sit inside a class that needs a Web Audio context to run, and a wrong
// one is only found by rendering.

/** Beats that pass in `seconds` at `bpm` beats a minute. */
export function beatsIn(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

/**
 * The audio-clock time to start a note on `noteBeat`, given the game is at `beat` when the clock reads `now`. A note
 * that is already behind the beat (a step that landed just after it) plays at once and not in the past, which the
 * audio clock cannot start a sound in.
 */
export function audioTime(noteBeat: number, beat: number, bpm: number, now: number): number {
  return Math.max(now, now + ((noteBeat - beat) * 60) / bpm);
}

/**
 * The beats a step hands out, as [from, to): from where the last step stopped, up to the lookahead past the beat. The
 * start is never more than a lookahead behind the beat, so that a long step (a tab that slept, a debugger) skips the
 * music it jumped over, and does not play all of it at once as a burst.
 */
export function scheduleWindow(
  scheduledUpTo: number,
  beat: number,
  lookaheadBeats: number,
): { from: number; to: number } {
  return { from: Math.max(scheduledUpTo, beat - lookaheadBeats), to: beat + lookaheadBeats };
}
