// How long the sounds take to make, held to what they took before, both ways, and to a budget.
//
//   npm run bench              measure, and fail if any scene is slower or faster than the baseline by more than the
//                              tolerance (and the slack), or costs more than its budget
//   npm run bench -- --update  write what it takes now as the new baseline
//
// Every sound is made at load, on the player's machine, which may be a phone: render time is what a game waits for
// before its first sound. The scenes are the costly parts of that, one render of each stock patch at 48000 Hz (eleven
// scenes, so that a change to one patch's cost is seen as that patch's), the default reverb's impulse, and the notes of
// the stock song over 64 beats, which the player asks for a few at a time but which a change to the sequencer would
// slow for every frame. Without it nothing holds the library to its load cost, and a change that makes a render twice
// as dear reaches every game before anyone has noticed.
//
// A time on one machine is not a time on another, or on the same one with something else running. So each scene is run
// several times, fresh, in a worker of its own, and the fastest run counts: noise only ever makes a run slower. And it
// is held to the baseline as a multiple of a fixed piece of arithmetic timed alongside it, so a baseline written on one
// machine means something on another. The milliseconds are reported too.
//
// It is held both ways: a scene that has got faster fails as surely as one that has got slower, since either it was
// meant, and the baseline is written again with the reason in the commit, or something has stopped being done. Each
// scene also has a budget in milliseconds, which no baseline can excuse. The judging is in bench-verdict.ts, where a
// node test holds it.
//
// Each scene is the same work every run, from a seeded source, and the bench checks that every run ends with the same
// checksum of what it made: a figure from a scene that does different work each time is no figure.
import { readFileSync, writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DEFAULT_REVERB } from '../src/audio';
import { ALL_PATCHES } from '../src/patches';
import { impulse } from '../src/reverb';
import { notes } from '../src/song';
import { calm } from '../src/songs';
import { render } from '../src/synth';
import { judge, overBudget } from './bench-verdict';

const BASELINE = 'scripts/bench-baseline.json';
// The tolerance is a share of the baseline, and each scene has a slack, an absolute amount on top: a render that costs
// a tenth of a millisecond has moved by two fifths between two quiet runs (jump, 0.070 to 0.098), and a twentieth of a
// millisecond is less than any change this gate is there to catch in a render that costs a millisecond. The song's notes
// cost four microseconds, so a slack that wide would hide a tenfold slowdown, and theirs is two.
const TOLERANCE = 0.2;
const RUNS = 7;
const SAMPLE_RATE = 48000;
const SEED = 20261018;

interface Result {
  ms: number;
  relative: number;
  ref: number;
  /** What the scene made, summed, so that every run can be shown to have done the same work. */
  checks: number[];
}

interface Scene {
  name: string;
  /** The most one call may take, in milliseconds, on the fastest run, whatever the baseline says. */
  budget: number;
  /** How far from the baseline, in milliseconds, before the tolerance counts. */
  slack: number;
  /** How many calls are timed together, so that a scene of a tenth of a millisecond is read off a longer clock. */
  reps: number;
  /** One call of the work, giving a number that depends on everything it made. */
  work: (random: () => number) => number;
}

// mulberry32, the tests' source, copied: scripts do not import from test/.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sum(s: Float32Array): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) total += s[i] * (1 + (i % 7));
  return total + s.length;
}

// The plan guessed a patch under 20 ms and the song's notes under 5. Measured on the machine the library is made on, the
// dearest patch (explode) takes about 1 ms, the impulse 0.2 ms and the notes 0.005 ms, so the budgets are ten times the
// dearest patch and the impulse, and a hundred times the notes: wide enough for a phone several times slower, and well
// inside the guess, so that a change that made any of them an order of magnitude dearer would be caught here whatever
// the baseline said.
const SCENES: Scene[] = [
  ...Object.entries(ALL_PATCHES).map(([name, patch]): Scene => ({
    name: `render ${name} at ${SAMPLE_RATE}`,
    budget: 10,
    slack: 0.05,
    reps: 20,
    work: (random) => sum(render(patch, SAMPLE_RATE, random)),
  })),
  {
    name: `impulse of the default reverb at ${SAMPLE_RATE}`,
    budget: 10,
    slack: 0.05,
    reps: 10,
    work: (random) => sum(impulse(DEFAULT_REVERB.seconds, DEFAULT_REVERB.decay, SAMPLE_RATE, random)),
  },
  {
    name: 'notes of calm over 64 beats',
    budget: 0.5,
    slack: 0.002,
    reps: 200,
    work: () => notes(calm, 0, 64).reduce((total, n) => total + n.beat + n.frequency + n.voice + n.gain, 0),
  },
];

// The reference: typed-array arithmetic of the synth's own kind, a filter and a waveshaper over a buffer, the same work
// every time, so that a figure here is against a thing that goes faster and slower with the machine much as the synth
// does.
function reference(): number {
  const n = 200_000;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.37);
  const t = performance.now();
  let y = 0;
  for (let pass = 0; pass < 20; pass++) {
    for (let i = 0; i < n; i++) {
      y += (x[i] - y) * 0.1;
      x[i] = Math.tanh(y) + Math.sign(y) * 1e-3;
    }
  }
  // the result is used, so that nothing can be dropped as dead
  if (!Number.isFinite(y + x[n >> 1])) throw new Error('reference: not finite');
  return performance.now() - t;
}

function measure(s: Scene): Result {
  let best = Infinity,
    ref = Infinity;
  const checks: number[] = [];
  for (let k = 0; k < 3; k++) reference();
  for (let k = 0; k < RUNS * 3; k++) ref = Math.min(ref, reference());
  for (let run = 0; run < RUNS; run++) {
    const random = seeded(SEED);
    let check = 0;
    const t = performance.now();
    for (let k = 0; k < s.reps; k++) check += s.work(random);
    best = Math.min(best, (performance.now() - t) / s.reps);
    checks.push(check);
  }
  return { ms: best, relative: best / ref, ref, checks };
}

function line(s: Scene, r: Result): string {
  return `${s.name}: ${r.ms.toFixed(4)} ms (${r.relative.toPrecision(3)} of the reference), budget ${s.budget} ms`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function main() {
  const update = process.argv.includes('--update');
  const results: Result[] = [];
  // one at a time, so no scene is timed while another runs beside it
  for (let index = 0; index < SCENES.length; index++) {
    results.push(
      await new Promise<Result>((resolve, reject) => {
        const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: { index } });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
    );
  }

  const unlike = SCENES.filter((_s, k) => results[k].checks.some((c) => c !== results[k].checks[0]));
  for (const s of unlike) console.error(`${s.name}: its runs made different things: not the same work each time`);
  const over = SCENES.filter((s, k) => overBudget(results[k].ms, s.budget));

  if (update) {
    SCENES.forEach((s, k) =>
      console.log(`${line(s, results[k])}${overBudget(results[k].ms, s.budget) ? ' OVER' : ''}`),
    );
    if (unlike.length || over.length) {
      console.error(`\nbaseline not written: ${unlike.length} unlike from run to run, ${over.length} over budget`);
      process.exitCode = 1;
      return;
    }
    const out = Object.fromEntries(
      SCENES.map((s, k) => [
        s.name,
        { relative: results[k].relative, ms: round4(results[k].ms), ref: round4(results[k].ref) },
      ]),
    );
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    console.log('baseline written');
    return;
  }

  let baseline: Partial<Record<string, { relative: number }>>;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as typeof baseline;
  } catch {
    console.error('no baseline: run npm run bench -- --update first');
    process.exitCode = 1;
    return;
  }
  let slower = 0,
    faster = 0,
    missing = 0,
    invalid = 0;
  SCENES.forEach((s, k) => {
    const now = results[k],
      was = baseline[s.name];
    if (!was) {
      console.log(`${line(s, now)}, not in the baseline`);
      missing++;
      return;
    }
    const { change, verdict } = judge(now, was, TOLERANCE, s.slack);
    if (verdict === 'SLOWER') slower++;
    if (verdict === 'FASTER') faster++;
    if (verdict === 'INVALID') invalid++;
    const percent = Math.round(change * 100) || 0;
    console.log(
      `${line(s, now)}${overBudget(now.ms, s.budget) ? ' OVER' : ''}, ${percent >= 0 ? '+' : ''}${percent}% on the baseline (${verdict})`,
    );
  });
  for (const name of Object.keys(baseline))
    if (!SCENES.some((s) => s.name === name)) {
      console.error(`${name}: in the baseline but not a scene`);
      missing++;
    }
  const scenes = (n: number) => `${n} scene${n === 1 ? '' : 's'}`;
  if (slower)
    console.error(`\n${scenes(slower)} slower than the baseline by more than ${TOLERANCE * 100}% and its slack`);
  if (faster)
    console.error(
      `\n${scenes(faster)} faster than the baseline by more than ${TOLERANCE * 100}% and its slack. If the change was meant ` +
        'to make it faster, write the baseline again with npm run bench -- --update and say why in the commit: quicker is as ' +
        'much a change as slower.',
    );
  if (invalid) console.error(`\n${scenes(invalid)} gave a figure that is not a number`);
  if (over.length) console.error(`\n${scenes(over.length)} over budget, which no baseline can excuse`);
  if (missing) console.error(`\n${scenes(missing)} not in the baseline: run npm run bench -- --update`);
  if (unlike.length) console.error(`\n${scenes(unlike.length)} not the same work from run to run`);
  if (slower || faster || invalid || over.length || missing || unlike.length) process.exitCode = 1;
}

if (!isMainThread) {
  const { index } = workerData as { index: number };
  parentPort?.postMessage(measure(SCENES[index]));
} else {
  await main();
}
