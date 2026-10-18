// The bench's judging, held on its own: the arithmetic that says a scene is slower, faster or within tolerance. The bench
// itself is timed and cannot be a node test, but a gate whose verdict is wrong passes in silence, so the verdict is a
// pure function (scripts/bench-verdict.ts) and these are its cases, edges included.
import { describe, expect, it } from 'vitest';
import { judge, overBudget } from '../scripts/bench-verdict';

const TOLERANCE = 0.2;
const SLACK = 0.05;
// A baseline of 0.1 of a reference that took 10 ms is a scene that took 1 ms.
const was = { relative: 0.1 };
const now = (ms: number, ref = 10) => ({ ms, ref, relative: ms / ref });

describe('the bench verdict', () => {
  it('is within tolerance for no change at all', () => {
    expect(judge(now(1), was, TOLERANCE, SLACK).verdict).toBe('within tolerance');
  });

  it('calls a scene over the tolerance and the slack slower', () => {
    const r = judge(now(1.5), was, TOLERANCE, SLACK);
    expect(r.verdict).toBe('SLOWER');
    expect(r.change).toBeCloseTo(0.5, 10);
  });

  it('calls a scene just over the tolerance slower, and just under it faster', () => {
    expect(judge(now(1.21), was, TOLERANCE, SLACK).verdict).toBe('SLOWER');
    expect(judge(now(0.79), was, TOLERANCE, SLACK).verdict).toBe('FASTER');
  });

  it('calls a scene as far under faster, since quicker is as much a change', () => {
    expect(judge(now(0.5), was, TOLERANCE, SLACK).verdict).toBe('FASTER');
  });

  it('holds a change of just under the tolerance either way within it', () => {
    expect(judge(now(1.19), was, TOLERANCE, SLACK).verdict).toBe('within tolerance');
    expect(judge(now(0.81), was, TOLERANCE, SLACK).verdict).toBe('within tolerance');
  });

  it('does not fail a change past the tolerance that is within the absolute slack', () => {
    const tiny = { relative: 0.001 };
    // 0.0 to 0.03 ms is thirty times over, but the slack is 0.05 ms
    expect(judge(now(0.03), tiny, TOLERANCE, SLACK).verdict).toBe('within tolerance');
    expect(judge(now(0.0), tiny, TOLERANCE, SLACK).verdict).toBe('within tolerance');
    expect(judge(now(0.2), tiny, TOLERANCE, SLACK).verdict).toBe('SLOWER');
  });

  it('measures the change against the machine, not the clock: a slower machine is not a slower scene', () => {
    // the reference took twice as long, so the scene taking twice as long is the same scene
    expect(judge(now(2, 20), was, TOLERANCE, SLACK).verdict).toBe('within tolerance');
    expect(judge(now(1, 20), was, TOLERANCE, SLACK).verdict).toBe('FASTER');
    expect(judge(now(3, 20), was, TOLERANCE, SLACK).verdict).toBe('SLOWER');
  });

  it('refuses a figure that is not a number, never calling it fine', () => {
    expect(judge(now(NaN), was, TOLERANCE, SLACK).verdict).toBe('INVALID');
    expect(judge(now(1), { relative: 0 }, TOLERANCE, SLACK).verdict).toBe('INVALID');
    expect(judge({ ms: 1, ref: 0, relative: Infinity }, was, TOLERANCE, SLACK).verdict).toBe('INVALID');
  });

  it('holds the budget hard, whatever the baseline says', () => {
    expect(overBudget(19.9, 20)).toBe(false);
    expect(overBudget(20, 20)).toBe(false);
    expect(overBudget(20.1, 20)).toBe(true);
    expect(overBudget(NaN, 20)).toBe(true);
  });
});
