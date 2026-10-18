// What a ConvolverNode makes of the impulse, in headless Chromium: a click sent through it comes out as the room, which
// is the impulse itself (the convolver is set not to normalise here, so the figures are the impulse's own).

import { describe, expect, it } from 'vitest';
import { impulse } from '../src/reverb';
import { rms } from '../src/loudness';
import { seeded } from './helpers';

const SR = 48000;

describe('the reverb through a convolver', () => {
  it('turns a click into the impulse, and a tail that dies away', async () => {
    const room = impulse(0.5, 5, SR, seeded(9));
    const context = new OfflineAudioContext(1, SR, SR);
    const convolver = context.createConvolver();
    convolver.normalize = false;
    const buffer = context.createBuffer(1, room.length, SR);
    buffer.copyToChannel(room as Float32Array<ArrayBuffer>, 0);
    convolver.buffer = buffer;
    const click = context.createBuffer(1, 1, SR);
    click.getChannelData(0)[0] = 1;
    const source = context.createBufferSource();
    source.buffer = click;
    source.connect(convolver).connect(context.destination);
    source.start();
    const out = (await context.startRendering()).getChannelData(0);

    const tenth = room.length / 10;
    expect(rms(out.subarray(0, tenth))).toBeGreaterThan(0.1);
    expect(rms(out.subarray(room.length - tenth, room.length))).toBeLessThan(rms(out.subarray(0, tenth)) / 10);
    // After the impulse ends there is nothing.
    expect(rms(out.subarray(room.length + 100))).toBeLessThan(1e-6);
    // And it is the impulse, to float precision.
    for (let i = 0; i < 1000; i += 37) expect(out[i]).toBeCloseTo(room[i], 4);
  });
});
