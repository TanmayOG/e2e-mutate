import { describe, expect, it } from 'vitest';
import { classifyRun, classifyTest, firstAppliedStep, mutantOutcome } from '../src/classify.ts';
import type { E2EAttempt, E2EReport, E2EResult, E2EStep } from '../src/report-json.ts';
import type { BaselineTest, Mutant, TestVerdict } from '../src/types.ts';

const mutant: Mutant = {
  id: 'm01-dead-control-upgrade',
  type: 'dead-control',
  title: 'The "Upgrade" button in the header does nothing on /account',
  before: 'works',
  after: 'does nothing when clicked',
  page: '/account',
  element: { role: 'button', name: 'Upgrade', region: 'header' },
  tests: ['tests/upgrade.e2e.ts:3'],
};

const baseline: BaselineTest = {
  key: 'tests/upgrade.e2e.ts:3',
  file: 'tests/upgrade.e2e.ts',
  line: 3,
  title: 'upgrade to the Pro plan',
  events: [],
  steps: [
    { index: 0, kind: 'app', api: 'app.open', label: '/account', durationMs: 50 },
    { index: 1, kind: 'agent', api: 'agent.act', label: 'upgrade to the Pro plan', cacheMode: 'self-finalized', durationMs: 170 },
    { index: 2, kind: 'agent', api: 'agent.assert', label: 'the plan is Pro', durationMs: 3000 },
  ],
};

const applied = (step: number) => ({ source: 'console', level: 'info', text: `[e2e-mutate] applied ${mutant.id}`, step });
const step = (index: number, api: string, status: string, extra: Partial<E2EStep> = {}): E2EStep => ({
  index,
  kind: api.startsWith('agent.') ? 'agent' : api.startsWith('expect') ? 'assertion' : 'app',
  api,
  label: baseline.steps[index]?.label ?? '',
  status,
  durationMs: 100,
  ...extra,
});
const attempt = (status: string, steps: E2EStep[], appLog: E2EAttempt['appLog'] = []): E2EAttempt => ({
  index: 0,
  status,
  startedAt: '2026-11-15T10:00:00.000Z',
  durationMs: 1000,
  steps,
  appLog,
});
const result = (status: string, attempts: E2EAttempt[]): E2EResult => ({
  id: 'r1',
  source: { file: 'tests/upgrade.e2e.ts', line: 3 },
  status,
  attempts,
});
const classify = (r: E2EResult) => classifyTest(r, baseline, mutant, '/run', '/out');

describe('firstAppliedStep', () => {
  it('returns the lowest step the bug applied at, and ignores other mutants and sources', () => {
    const a = attempt('passed', [], [
      { source: 'console', level: 'info', text: '[e2e-mutate] applied m02-other', step: 0 },
      { source: 'error', level: 'error', text: `[e2e-mutate] applied ${mutant.id}`, step: 0 },
      applied(2),
      applied(1),
    ]);
    expect(firstAppliedStep(a, mutant.id)).toBe(1);
  });
  it('treats an applied line with no step as before the first step', () => {
    const a = attempt('passed', [], [{ source: 'console', level: 'info', text: `[e2e-mutate] applied ${mutant.id}` }]);
    expect(firstAppliedStep(a, mutant.id)).toBe(-1);
  });
  it('is undefined when the bug never applied', () => {
    expect(firstAppliedStep(attempt('passed', []), mutant.id)).toBeUndefined();
  });
});

const passingSteps = (actMode: string) => [
  step(0, 'app.open', 'passed'),
  step(1, 'agent.act', 'passed', { cache: { mode: actMode, reason: actMode === 'self-finalized' ? undefined : 'end-mismatch', detail: 'missing status "Pro"' } as E2EStep['cache'], durationMs: 37000 }),
  step(2, 'agent.assert', 'passed'),
];

describe('classifyTest', () => {

  it('not reached: the test passed and the bug never applied', () => {
    expect(classify(result('passed', [attempt('passed', passingSteps('self-finalized'))])).outcome).toBe('not-reached');
  });

  it('got through: the test passed with the bug applied and nothing healed', () => {
    const verdict = classify(result('passed', [attempt('passed', passingSteps('self-finalized'), [applied(1)])]));
    expect(verdict.outcome).toBe('got-through');
    expect(verdict.passedJudgments).toEqual(['the plan is Pro']);
  });

  it('healed past: a step that replayed fully in the baseline handed off, and the test still passed', () => {
    const verdict = classify(result('passed', [attempt('passed', passingSteps('agent-concluded'), [applied(1)])]));
    expect(verdict.outcome).toBe('healed-past');
    expect(verdict.healed).toEqual([
      { index: 1, label: 'upgrade to the Pro plan', reason: 'end-mismatch', detail: 'missing status "Pro"', durationMs: 37000, baselineMs: 170 },
    ]);
  });

  it('a hand-off on a step that was not self-finalized in the baseline is not healing', () => {
    const notReplayed: BaselineTest = { ...baseline, steps: baseline.steps.map((s) => (s.index === 1 ? { ...s, cacheMode: 'missed' } : s)) };
    const verdict = classifyTest(result('passed', [attempt('passed', passingSteps('agent-concluded'), [applied(1)])]), notReplayed, mutant, '/run', '/out');
    expect(verdict.outcome).toBe('got-through');
  });

  it('caught: the failing step started at or after the step where the bug applied', () => {
    const steps = [step(0, 'app.open', 'passed'), step(1, 'agent.act', 'failed', { error: { code: 'ACTION_FAILED', message: 'no route' } })];
    const verdict = classify(result('failed', [attempt('failed', steps, [applied(1)])]));
    expect(verdict.outcome).toBe('caught');
    expect(verdict.failedStep).toMatchObject({ index: 1, api: 'agent.act', code: 'ACTION_FAILED' });
  });

  it('failed before: the test failed before the bug applied, so it is noise', () => {
    const steps = [step(0, 'app.open', 'failed')];
    expect(classify(result('failed', [attempt('failed', steps, [applied(1)])])).outcome).toBe('failed-before');
    expect(classify(result('failed', [attempt('failed', steps)])).outcome).toBe('failed-before');
  });

  it('timed out after the bug applied counts as caught (timed-out)', () => {
    const steps = [step(0, 'app.open', 'passed'), step(1, 'agent.act', 'timed-out')];
    expect(classify(result('timed-out', [attempt('timed-out', steps, [applied(0)])])).outcome).toBe('timed-out');
  });

  it('flaky: the attempts disagreed under the same bug', () => {
    const r = result('passed', [attempt('failed', [], [applied(1)]), { ...attempt('passed', passingSteps('self-finalized'), [applied(1)]), index: 1 }]);
    expect(classify(r).outcome).toBe('flaky');
  });
});

const v = (outcome: TestVerdict['outcome']): TestVerdict => ({ test: 't', title: 't', outcome, healed: [], passedJudgments: [] });

describe('mutantOutcome', () => {
  it('any catch catches the mutant', () => expect(mutantOutcome([v('got-through'), v('caught')])).toBe('caught'));
  it('a timeout catches it too', () => expect(mutantOutcome([v('timed-out'), v('healed-past')])).toBe('caught'));
  it('healed past outranks got through', () => expect(mutantOutcome([v('got-through'), v('healed-past')])).toBe('healed-past'));
  it('got through outranks not reached', () => expect(mutantOutcome([v('not-reached'), v('got-through')])).toBe('got-through'));
  it('only noise is inconclusive', () => expect(mutantOutcome([v('not-reached'), v('failed-before')])).toBe('inconclusive'));
  it('nothing reached is not reached', () => expect(mutantOutcome([v('not-reached')])).toBe('not-reached'));
});

// Times on one clock, as e2e reports them: step start + duration, and the app-log line's `at`.
const at = (ms: number) => new Date(Date.UTC(2026, 10, 15, 12, 0, 0, ms)).toISOString();
const timed = (index: number, api: string, status: string, start: number, durationMs: number, extra: Partial<E2EStep> = {}): E2EStep => ({
  ...step(index, api, status, extra),
  startedAt: at(start),
  durationMs,
});
const appliedAt = (stepIndex: number, ms: number) => ({ source: 'console', level: 'info', text: `[e2e-mutate] applied ${mutant.id}`, step: stepIndex, at: at(ms) });

describe('failures are read by time, not by step number', () => {
  it('a wrapping step that fails because of its own trigger is a catch', () => {
    // waitForDownload (step 2) wraps the tap (step 3) that hits the dead link; it is numbered first but was still running.
    const steps = [timed(0, 'app.open', 'passed', 0, 20), timed(2, 'browser.waitForDownload', 'failed', 30, 30000), timed(3, 'locator.tap', 'passed', 31, 60)];
    const verdict = classify(result('failed', [attempt('failed', steps, [appliedAt(3, 90)])]));
    expect(verdict.outcome).toBe('caught');
    expect(verdict.failedStep).toMatchObject({ index: 2, api: 'browser.waitForDownload' });
  });
  it('a step that had already finished failing before the bug applied is noise, whatever its number', () => {
    const steps = [timed(0, 'app.open', 'passed', 0, 20), timed(4, 'expect.toHaveText', 'failed', 30, 50)];
    expect(classify(result('failed', [attempt('failed', steps, [appliedAt(2, 500)])])).outcome).toBe('failed-before');
  });
  it('a failed step the test caught and went on from is not the failure; the attempt error after the bug applied is a catch', () => {
    // tap({ timeout }).catch(…) expects step 1 to fail; the test then fails on `expect(clicked).toBe(true)`, outside any step.
    const caughtTap = timed(1, 'locator.tap', 'failed', 10, 700, { error: { code: 'ACTION_FAILED', message: 'tap did not become actionable in time' } });
    const steps = [timed(0, 'app.open', 'passed', 0, 5), caughtTap, timed(2, 'browser.evaluate', 'passed', 800, 3)];
    const failedAttempt = { ...attempt('failed', steps, [appliedAt(2, 805)]), error: { code: 'ASSERTION_FAILED', message: 'expected undefined to be true' } };
    const verdict = classify(result('failed', [failedAttempt]));
    expect(verdict.outcome).toBe('caught');
    expect(verdict.failedStep).toBeUndefined();
    expect(verdict.failure).toEqual({ code: 'ASSERTION_FAILED', message: 'expected undefined to be true' });
  });
  it('of two failed steps, the one carrying the attempt error is the failure', () => {
    const ambiguous = timed(1, 'locator.tap', 'failed', 10, 20, { error: { code: 'LOCATOR_AMBIGUOUS', message: 'two matches' } });
    const count = timed(2, 'expect.toHaveCount', 'failed', 40, 20, { error: { code: 'ASSERTION_FAILED', message: 'expect.toHaveCount failed' } });
    const failedAttempt = { ...attempt('failed', [ambiguous, count], [appliedAt(0, 5)]), error: { code: 'ASSERTION_FAILED', message: 'expect.toHaveCount failed' } };
    expect(classify(result('failed', [failedAttempt])).failedStep).toMatchObject({ index: 2, api: 'expect.toHaveCount' });
  });
  it('without an attempt error (an older report), the last failed step is the failure', () => {
    const tolerated = timed(1, 'locator.tap', 'failed', 10, 20);
    const real = timed(3, 'expect.toHaveText', 'failed', 400, 20);
    const verdict = classify(result('failed', [attempt('failed', [tolerated, timed(2, 'app.open', 'passed', 100, 10), real], [appliedAt(2, 105)])]));
    expect(verdict).toMatchObject({ outcome: 'caught', failedStep: { index: 3 } });
  });
  it('a test that never ran was not reached by the bug, with or without an attempt', () => {
    expect(classify(result('skipped', [attempt('skipped', [])])).outcome).toBe('not-reached');
    // What e2e writes for a test whose setup failed: no attempt at all.
    expect(classify(result('skipped', [])).outcome).toBe('not-reached');
  });
  it('of two failures with the same error, the later one is the failure: the earlier one the test caught', () => {
    const error = { code: 'ACTION_FAILED', message: 'tap did not become actionable in time' };
    const tolerated = timed(1, 'locator.tap', 'failed', 10, 20, { error });
    const real = timed(3, 'locator.tap', 'failed', 400, 20, { error });
    const failedAttempt = { ...attempt('failed', [tolerated, timed(2, 'app.open', 'passed', 100, 10), real], [appliedAt(2, 105)]), error };
    expect(classify(result('failed', [failedAttempt]))).toMatchObject({ outcome: 'caught', failedStep: { index: 3 } });
  });
});

const report = (results: E2EResult[]): E2EReport => ({ schemaVersion: '1', run: { status: 'failed', exitCode: 1, results } });

const setup = (status: string, steps: E2EStep[], log: E2EAttempt['appLog']): E2EResult => ({
  id: 's1',
  kind: 'setup',
  titlePath: ['authenticate as admin'],
  source: { file: 'tests/auth.setup.e2e.ts', line: 4 },
  status,
  attempts: [attempt(status, steps, log)],
});

describe('classifyRun and setup tests', () => {
  // e2e records no attempt for a test whose setup failed.
  const dependent: E2EResult = { ...result('skipped', []), id: 'r1' };
  const baselineMap = new Map([[baseline.key, baseline]]);

  it('a setup that fails after the bug applied catches it, and its skipped dependents were not reached', () => {
    const failedSetup = setup('failed', [timed(0, 'app.open', 'passed', 0, 10), timed(1, 'expect.toHaveText', 'failed', 20, 5000)], [appliedAt(0, 15)]);
    const verdicts = classifyRun(report([dependent, failedSetup]), mutant, baselineMap, '/run', '/out');
    expect(verdicts.map((x) => [x.title, x.outcome])).toEqual([
      ['upgrade to the Pro plan', 'not-reached'],
      ['authenticate as admin (setup)', 'caught'],
    ]);
    expect(mutantOutcome(verdicts)).toBe('caught');
  });
  it('a setup that failed before the bug applied is noise, so the bug is inconclusive and gets rerun', () => {
    const failedSetup = setup('failed', [timed(0, 'app.open', 'failed', 0, 10)], [appliedAt(0, 900)]);
    const verdicts = classifyRun(report([dependent, failedSetup]), mutant, baselineMap, '/run', '/out');
    expect(verdicts.map((x) => [x.title, x.outcome])).toEqual([
      ['upgrade to the Pro plan', 'not-reached'],
      ['authenticate as admin (setup)', 'failed-before'],
    ]);
    expect(mutantOutcome(verdicts)).toBe('inconclusive');
  });
  it('a setup that passed adds nothing', () => {
    const passedSetup = setup('passed', [timed(0, 'app.open', 'passed', 0, 10)], [appliedAt(0, 5)]);
    expect(classifyRun(report([dependent, passedSetup]), mutant, baselineMap, '/run', '/out')).toHaveLength(1);
  });
});

describe('tests that share a line', () => {
  it('run as one unit, and the strongest verdict among them stands', () => {
    const baselineMap = new Map([[baseline.key, baseline]]);
    const passedWithBug = { ...result('passed', [attempt('passed', [step(0, 'app.open', 'passed')], [applied(0)])]), id: 'r1' };
    const caughtIt = { ...result('failed', [attempt('failed', [step(0, 'app.open', 'passed'), step(1, 'expect.toHaveText', 'failed')], [applied(0)])]), id: 'r2' };
    const verdicts = classifyRun(report([passedWithBug, caughtIt]), mutant, baselineMap, '/run', '/out');
    expect(verdicts.map((x) => x.outcome)).toEqual(['caught']);
  });
});

const handedOff = (start: number) => timed(1, 'agent.act', 'passed', start, 3000, { cache: { mode: 'agent-concluded', reason: 'end-mismatch' } });

describe('a passing test is judged only by steps that could have seen the bug', () => {
  it('an agent hand-off that ended before the bug applied is not healing past it', () => {
    const steps = [timed(0, 'app.open', 'passed', 0, 10), handedOff(10), timed(2, 'agent.assert', 'passed', 5000, 2000)];
    const verdict = classify(result('passed', [attempt('passed', steps, [appliedAt(2, 4000)])]));
    expect(verdict.outcome).toBe('got-through');
    expect(verdict.passedJudgments).toEqual(['the plan is Pro']);
  });
  it('a hand-off still running when the bug applied healed past it', () => {
    const steps = [timed(0, 'app.open', 'passed', 0, 10), handedOff(10)];
    expect(classify(result('passed', [attempt('passed', steps, [appliedAt(1, 500)])])).outcome).toBe('healed-past');
  });
  it('a check that ended before the bug applied did not pass with the bug', () => {
    const steps = [timed(0, 'app.open', 'passed', 0, 10), timed(2, 'agent.assert', 'passed', 20, 100)];
    // Logged under step 2, as e2e files a line between steps under the last one started, but after that step ended.
    expect(classify(result('passed', [attempt('passed', steps, [appliedAt(2, 900)])])).passedJudgments).toEqual([]);
  });
});
