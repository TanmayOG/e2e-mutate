import type { TestVerdict } from './types.ts';

const rank = (test: TestVerdict) =>
  test.outcome === 'healed-past' ? 0 : test.outcome === 'got-through' && test.passedJudgments.length > 0 ? 1 : test.outcome === 'got-through' ? 2 : 3;

/**
 * Orders the tests that let a bug through by how much they explain it:
 * a test that healed past it, then one whose own `agent.assert` passed after
 * the bug appeared, then one that only passed through the page. Reports lead
 * with the first and group the rest, so a bug on a page every test visits
 * doesn't read as seven separate failures.
 */
export function relevantMisses(tests: readonly TestVerdict[]): TestVerdict[] {
  return tests.filter((test) => rank(test) < 3).toSorted((a, b) => rank(a) - rank(b));
}
