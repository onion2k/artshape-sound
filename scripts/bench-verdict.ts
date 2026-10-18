// The bench's judging, apart from its timing so that a node test can hold it. A gate that judges wrongly passes every
// run in silence, and the timed part cannot be tested without a clock; this part is only arithmetic.

export type Verdict = 'SLOWER' | 'FASTER' | 'within tolerance' | 'INVALID';

export interface Figure {
  /** Milliseconds the scene took, the fastest run. */
  ms: number;
  /** Milliseconds the reference loop took on this machine just now. */
  ref: number;
  /** The scene against the reference: ms over ref. */
  relative: number;
}

// How the scene compares with its baseline: the change in `relative`, and a verdict that needs it past the tolerance
// and also past the absolute slack, so a scene that costs next to nothing is not failed for a hair of noise. The slack
// is taken on this machine's milliseconds, from what the baseline's relative figure comes to against today's reference.
// A figure that is not a finite number is INVALID and never fine, because NaN fails every comparison and would
// otherwise read as within tolerance.
export function judge(
  now: Figure,
  was: { relative: number },
  tolerance: number,
  slackMs: number,
): { change: number; verdict: Verdict } {
  const finite = [now.ms, now.ref, now.relative, was.relative].every(Number.isFinite);
  if (!finite || was.relative <= 0 || now.ref <= 0) return { change: NaN, verdict: 'INVALID' };
  const change = now.relative / was.relative - 1;
  const expected = was.relative * now.ref;
  if (change > tolerance && now.ms - expected > slackMs) return { change, verdict: 'SLOWER' };
  if (change < -tolerance && expected - now.ms > slackMs) return { change, verdict: 'FASTER' };
  return { change, verdict: 'within tolerance' };
}

// The budget no baseline excuses. NaN is over, since it is not under anything.
export function overBudget(ms: number, budget: number): boolean {
  return !(ms <= budget);
}
