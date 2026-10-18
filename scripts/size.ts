// The size gate: each entry bundled by esbuild to a minified ES module, gzipped, and held to a baseline exactly and
// under a budget. Without it the library could grow by a few hundred bytes a part and no one would see, and a game that
// pins it would pay for that in its download. The measure is what a game ships (an entry and what it imports,
// minified, gzipped at level 9), not the source's size.
//
// An entry is one line in ENTRIES. SIZE_UPDATE=1 writes the baseline again, for a change meant to move it; the commit
// says why. The budget is the figure measured when the entry was added, plus a half.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ENTRIES: { entry: string; budget: number }[] = [
  { entry: 'src/synth.ts', budget: 1981 },
  // set again at 0.3.0, when Audio came to load a layered sound: 8369 measured then, plus a half
  { entry: 'src/audio.ts', budget: 12554 },
  // set again at 0.3.0, when a song's check came to check a layered voice: 4306 measured then, plus a half
  { entry: 'src/player.ts', budget: 6459 },
  { entry: 'src/layers.ts', budget: 9750 },
  { entry: 'src/ambience.ts', budget: 1467 },
];

const BASELINE = 'scripts/size-baseline.json';
const update = process.env.SIZE_UPDATE === '1';
function readBaseline(): Record<string, number | undefined> {
  return update ? {} : (JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>);
}
const baseline = readBaseline();
const measured: Record<string, number> = {};
const problems: string[] = [];

for (const { entry, budget } of ENTRIES) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'warning',
  });
  const code = result.outputFiles.length > 0 ? result.outputFiles[0].contents : new Uint8Array(0);
  // A bundle of nothing would pass every comparison, so it is a failure of its own.
  if (code.length === 0) {
    problems.push(`${entry}: the bundle is empty`);
    continue;
  }
  const bytes = gzipSync(code, { level: 9 }).length;
  measured[entry] = bytes;
  console.log(
    `${entry}: ${bytes} bytes gzipped (${code.length} minified), budget ${budget}, baseline ${baseline[entry] ?? 'none'}`,
  );
  if (bytes > budget) problems.push(`${entry}: ${bytes} bytes is over its budget of ${budget}`);
  if (!update && baseline[entry] === undefined) problems.push(`${entry}: no baseline; SIZE_UPDATE=1 writes one`);
  else if (!update && baseline[entry] !== bytes)
    problems.push(`${entry}: ${bytes} bytes is not its baseline of ${baseline[entry]}`);
}
if (!update) {
  for (const entry of Object.keys(baseline)) {
    if (!ENTRIES.some((e) => e.entry === entry)) problems.push(`${entry}: in the baseline but not in ENTRIES`);
  }
}

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify(measured, null, 2)}\n`);
  console.log(`wrote ${BASELINE}`);
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
