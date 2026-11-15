import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DrillResult } from '../src/drill.ts';
import { beforeLabel, writeHtmlReport } from '../src/report/html.ts';
import { explain, renderTerminal } from '../src/report/terminal.ts';
import type { Mutant, MutantVerdict, TestVerdict } from '../src/types.ts';

const mutant = (over: Partial<Mutant>): Mutant => ({ id: 'm1', type: 'missing-element', title: 'The order total is missing on /order/:id', before: '$12.50', after: '(not shown)', tests: ['t'], ...over });
const test = (over: Partial<TestVerdict>): TestVerdict => ({ test: 't', title: 'check out a cart', outcome: 'got-through', healed: [], passedJudgments: [], ...over });
const verdict = (over: Partial<MutantVerdict>): MutantVerdict => ({ mutant: mutant({}), outcome: 'got-through', tests: [test({})], durationMs: 3100, costUsd: 0, runDir: 'runs/m1', suggestions: [], ...over });

const result = (mutants: MutantVerdict[]): DrillResult => ({
  startedAt: '2026-11-15T11:00:00.000Z',
  durationMs: 1000,
  costUsd: 1.5,
  baseline: { tests: [{ key: 't', title: 'check out a cart' }], skipped: [], costUsd: 0.2, durationMs: 100 },
  candidates: mutants.length,
  ignored: 0,
  notRun: [],
  mutants,
  caught: mutants.filter((v) => v.outcome === 'caught').length,
  missed: mutants.filter((v) => v.outcome === 'got-through' || v.outcome === 'healed-past').length,
  catchRate: 1 / 3,
  perTest: [{ key: 't', title: 'check out a cart', caught: 1, missed: 2 }],
  warnings: [],
});

describe('beforeLabel', () => {
  it('shows the recorded value when it has letters or digits', () => {
    expect(beforeLabel({ mutant: mutant({ before: '$12.50' }) })).toBe('$12.50');
  });
  it('names the element when the recorded value was a loading placeholder', () => {
    expect(beforeLabel({ mutant: mutant({ before: '…', element: { testId: 'order-total' } }) })).toBe('the order total');
  });
});

describe('writeHtmlReport', () => {
  const healedTest = test({ outcome: 'healed-past', healed: [{ index: 1, label: 'open the cart', reason: 'end-mismatch', durationMs: 26000, baselineMs: 690 }] });
  const drill = result([
    verdict({ outcome: 'caught', tests: [test({ outcome: 'caught', failedStep: { index: 2, kind: 'assertion', api: 'expect.toBeVisible', label: 'x', code: 'ASSERTION_FAILED' } })] }),
    verdict({ mutant: mutant({ id: 'm2', before: '…', element: { testId: 'order-total' } }) }),
    verdict({ mutant: mutant({ id: 'm3', type: 'dead-control', title: 'The "Cart (3)" link in the nav does nothing on /' }), outcome: 'healed-past', tests: [healedTest] }),
  ]);

  it('splits the misses in the headline: got through apart from healed past', async () => {
    const html = await readFile(await writeHtmlReport(drill, await mkdtemp(path.join(tmpdir(), 'e2e-mutate-'))), 'utf8');
    expect(html).toContain('<b>1</b> got through');
    expect(html).toContain('<b>1</b> healed past by the agent');
  });
  it('says a test passed with the bug in place, without claiming what its checks look at', async () => {
    const html = await readFile(await writeHtmlReport(drill, await mkdtemp(path.join(tmpdir(), 'e2e-mutate-'))), 'utf8');
    expect(html).toContain('<strong>check out a cart</strong> passed with the bug in place.');
    expect(html).not.toContain('none of its checks');
  });
  it('shows how much slower a healed step was than its replay', async () => {
    const html = await readFile(await writeHtmlReport(drill, await mkdtemp(path.join(tmpdir(), 'e2e-mutate-'))), 'utf8');
    expect(html).toContain('26.0s instead of 0.69s replayed');
  });
  it('labels the per-test numbers as bugs that reached the test', () => {
    expect(renderTerminal(drill)).toContain('By test (of the bugs that reached it):');
  });
});

describe('per-test summary', () => {
  const drill = {
    ...result([verdict({ outcome: 'caught', tests: [test({ outcome: 'caught' })] })]),
    perTest: [
      { key: 't', title: 'check out a cart', caught: 1, missed: 0 },
      { key: 'u', title: 'reload runs the page again', caught: 0, missed: 0 },
      { key: 'v', title: 'cookies read back', caught: 0, missed: 0 },
    ],
  };
  it('lists only the tests a scored bug reached, and counts the rest, in the terminal', () => {
    const text = renderTerminal(drill);
    expect(text).toContain('check out a cart');
    expect(text).not.toContain('reload runs the page again');
    expect(text).toContain('and 2 tests no scored bug reached');
  });
  it('does the same in the HTML report', async () => {
    const html = await readFile(await writeHtmlReport(drill, await mkdtemp(path.join(tmpdir(), 'e2e-mutate-'))), 'utf8');
    expect(html).not.toContain('reload runs the page again');
    expect(html).toContain('2 more tests: no scored bug reached them.');
  });
});

describe('explain', () => {
  it('names the error of a catch outside any step, instead of calling it a timeout', () => {
    const v = verdict({ outcome: 'caught', tests: [test({ outcome: 'caught', failure: { code: 'ASSERTION_FAILED', message: 'expected "Was not clicked" to be "Clicked"\nat line 3' } })] });
    expect(explain(v)).toBe('check out a cart › expected "Was not clicked" to be "Clicked"');
  });
  it('says timed out only for a timeout', () => {
    expect(explain(verdict({ outcome: 'caught', tests: [test({ outcome: 'timed-out' })] }))).toBe('check out a cart › timed out');
  });
});
