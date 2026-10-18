// A song played by an Audio: stepped by game time, scheduled on the audio clock. The game calls step(dt) each frame
// with the time that frame took (so a paused game steps nothing and the music waits), and the player works out which
// notes fall in the next lookahead and hands each to the Audio with the time on the audio clock to start it. That is
// the standard way to keep time in Web Audio: the frame decides what to schedule, and the audio clock, which does not
// stutter when a frame does, decides when it sounds. Without the lookahead a frame that ran long would make a note
// late, and without the audio clock every note would wobble by the frame's jitter.
//
// The player reads no wall clock. The one reading it takes is the audio clock, through Audio.time, and only
// to place a note; the song's own position is `beat`, which only step moves. What a note is (its
// beat, pitch and gain) comes from notes() in song.ts, and the sums are in schedule.ts so that node holds them.

import { MAX_PITCH, type Audio } from './audio';
import { audioTime, beatsIn, scheduleWindow } from './schedule';
import { checkSong, notes, type Song } from './song';

export interface PlayerOptions {
  lookahead?: number; // seconds of notes to hand over ahead of the beat, above 0, default 0.1
}

export const DEFAULT_LOOKAHEAD = 0.1;

// Each player numbers its buffers, so that two players on one Audio, or a song's voice and a game's own sound called
// `song:0`, do not replace one another's.
let players = 0;

export class Player {
  private readonly audio: Audio;
  private readonly song: Song;
  private readonly lookaheadBeats: number;
  // One name and one pitch reference per voice: the name the voice's buffer was loaded under, and the frequency it was
  // rendered at, which a note's own frequency is measured against.
  private readonly names: string[];
  private readonly base: number[];
  // Which voices keep their own pitch: a drum is played as it was rendered, whatever its pattern says.
  private readonly fixed: boolean[];
  private position = 0;
  // The beat up to which notes have been handed out, exclusive: the next step starts there, so no note goes out twice.
  private scheduledUpTo = 0;

  constructor(audio: Audio, song: Song, options: PlayerOptions = {}) {
    const problem = checkSong(song);
    if (problem !== null) throw new Error(`Player: ${problem}`);
    const lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD;
    if (!Number.isFinite(lookahead) || lookahead <= 0)
      throw new Error(`Player: lookahead must be a number of seconds above 0, got ${lookahead}`);
    this.audio = audio;
    this.song = song;
    this.lookaheadBeats = beatsIn(lookahead, song.bpm);
    const id = players++;
    // One buffer a voice, rendered once at the patch's own frequency. A note then plays that buffer at a different
    // rate to reach its pitch, which is a multiplication per sample and costs nothing at play time, where rendering
    // each pitch would cost a render per note. It is a resampling and not a new synthesis, so it moves the whole sound
    // with the pitch: the attack and the release shorten as the pitch rises, a filter's cutoff and the vibrato move
    // with it, and the noise changes its colour. That is not noticed within an octave or so and is plain past two,
    // which is also where Audio.play stops (MAX_PITCH), so a voice is to be given a patch near where it plays.
    // Voices that carry the very same patch object (a strum of one electric piano, a hat on and off the beat) share one
    // buffer and one render, under the name of the first of them; a copy that merely equals it is its own voice.
    const loaded = new Map<object, string>();
    this.names = song.voices.map((voice, i) => {
      const shared = loaded.get(voice.patch);
      if (shared !== undefined) return shared;
      const name = `song${id}:${i}`;
      audio.load(name, voice.patch);
      loaded.set(voice.patch, name);
      return name;
    });
    this.base = song.voices.map((voice) => voice.patch.frequency ?? 1);
    this.fixed = song.voices.map((voice) => voice.fixed === true);
  }

  // Where the song is, in beats from its start.
  get beat(): number {
    return this.position;
  }

  // Moves the song on by `dt` seconds of game time and hands over every note that falls before the lookahead's end.
  // A step of nothing hands over nothing new. A step of a long time (a tab that slept, a debugger) moves the beat all
  // the same but hands over only the notes near the new beat, and not the music it jumped over: all of that in one
  // go would be a burst of noise, and it is not music anyone was there to hear.
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error(`Player.step: dt must be a number of seconds from 0, got ${dt}`);
    this.position += beatsIn(dt, this.song.bpm);
    const { from, to } = scheduleWindow(this.scheduledUpTo, this.position, this.lookaheadBeats);
    // Read once a step, so every note of it is placed against the same reading. It throws for a disposed Audio, so a
    // step with no note to play still says so.
    const now = this.audio.time;
    for (const note of notes(this.song, from, to)) {
      // Never past what Audio can play. A note further than two octaves from its patch is played at the edge, a wrong
      // note and not a thrown error, in a game that should not stop for the pitch of one voice.
      const pitch = this.fixed[note.voice]
        ? 1
        : Math.min(MAX_PITCH, Math.max(1 / MAX_PITCH, note.frequency / this.base[note.voice]));
      this.audio.play(this.names[note.voice], {
        gain: note.gain,
        pitch,
        at: audioTime(note.beat, this.position, this.song.bpm, now),
      });
    }
    this.scheduledUpTo = to;
  }

  // Pauses the song at its beat. The player schedules only inside step, so there is nothing to cancel: it sounds the
  // notes already handed over (under a lookahead long) and then is silent, and the next step goes on from the same
  // beat without playing any of those again.
  stop(): void {
    // Nothing is kept running, and so nothing is undone; the method says what the caller means.
  }
}
