import { describe, expect, it } from 'vitest';

// The one test the repo has before any module: it holds only that vitest finds and runs a test here.
describe('the repo', () => {
  it('runs a test', () => {
    expect(1 + 1).toBe(2);
  });
});
