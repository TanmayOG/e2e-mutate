import { existsSync } from 'node:fs';
import path from 'node:path';
import { finalAttempt, resultKey, type E2EAttempt, type E2EReport, type E2EResult, type E2EStep } from './report-json.ts';
import type { BaselineTest, HealedStep, Mutant, MutantOutcome, TestOutcome, TestVerdict } from './types.ts';

const APPLIED = '[e2e-mutate] applied ';
const FAILED = new Set(['failed', 'timed-out', 'blocked']);

/** The first step index the mutant's "applied" line appears at, or undefined when it never applied. -1: before any step. */
export function firstAppliedStep(attempt: E2EAttempt, mutantId: string): number | undefined {
  return firstApplied(attempt, mutantId)?.step;
}

/** When the bug first applied in an attempt: the step it happened in, and the time, when e2e recorded one. */
export function firstApplied(attempt: E2EAttempt, mutantId: string): { step: number; at?: number } | undefined {
  let first: { step: number; at?: number } | undefined;
  for (const line of attempt.appLog ?? []) {
    if (line.source !== 'console' || line.text !== `${APPLIED}${mutantId}`) continue;
    const step = line.step ?? -1;
    const at = line.at !== undefined ? Date.parse(line.at) : Number.NaN;
    const candidate = Number.isFinite(at) ? { step, at } : { step };
    if (first === undefined || (candidate.at !== undefined && first.at !== undefined ? candidate.at < first.at : step < first.step)) first = candidate;
  }
  return first;
}

/**
 * True when a step was still running when the bug first applied, or started
 * after: it could have seen the bug. Without timestamps, by step number.
 */
export function sawBug(step: E2EStep, applied: { step: number; at?: number }): boolean {
  const started = step.startedAt !== undefined ? Date.parse(step.startedAt) : Number.NaN;
  if (applied.at !== undefined && Number.isFinite(started)) return started + (step.durationMs ?? 0) >= applied.at;
  return step.index >= applied.step;
}

/**
 * The step that failed the test: the failed step that carries the attempt's
 * own error. A step that failed and that the test caught and went on from
 * (`tap().catch(…)` around an expected failure) is not it. When the test failed
 * outside any step, such as an `expect` on a plain value or its own code
 * throwing, there is none. A report with no attempt error falls back to the
 * last failed step.
 */
export function failingStep(attempt: E2EAttempt): E2EStep | undefined {
  const failed = (attempt.steps ?? []).filter((step) => FAILED.has(step.status));
  const error = attempt.error;
  // The last one: an earlier failure with the same error is one the test caught and went on from.
  if (!error) return failed.at(-1);
  return failed.findLast((step) => step.error?.code === error.code && step.error?.message === error.message);
}

/**
 * Reads a failed attempt against the moment the bug first applied. A failure
 * is a catch when the step that failed the test was still running at that
 * moment or started after it. Comparing times, not step numbers, matters for
 * steps that wrap their trigger: `waitForDownload(() => link.click())` is
 * numbered before the click it waits on, and fails because of it. Without
 * timestamps it falls back to step numbers. A test that failed outside any
 * step after the bug applied failed after its last step, so that is a catch.
 */
export function readFailure(
  attempt: E2EAttempt,
  status: string,
  mutantId: string,
): { outcome: 'failed-before' | 'caught' | 'timed-out'; failing?: E2EStep } {
  const applied = firstApplied(attempt, mutantId);
  const failing = failingStep(attempt);
  if (applied === undefined) return { outcome: 'failed-before', ...(failing ? { failing } : {}) };
  if (failing && !sawBug(failing, applied)) return { outcome: 'failed-before', failing };
  const outcome = status === 'timed-out' || failing?.status === 'timed-out' ? 'timed-out' : 'caught';
  return { outcome, ...(failing ? { failing } : {}) };
}

/** The test's own error, for a catch outside any step: what the report shows instead of a step. */
const failureOf = (attempt: E2EAttempt, failing: E2EStep | undefined) =>
  !failing && attempt.error ? { failure: { ...(attempt.error.code !== undefined ? { code: attempt.error.code } : {}), ...(attempt.error.message !== undefined ? { message: attempt.error.message } : {}) } } : {};

const failedStepOf = (failing: E2EStep | undefined) =>
  failing
    ? {
        failedStep: {
          index: failing.index,
          kind: failing.kind,
          api: failing.api,
          label: failing.label ?? '',
          ...(failing.error?.code !== undefined ? { code: failing.error.code } : {}),
          ...(failing.error?.message !== undefined ? { message: failing.error.message } : {}),
        },
      }
    : {};

/** Artifacts of an attempt as paths relative to the drill's output dir. */
function artifactsOf(attempt: E2EAttempt, runDir: string, outDir: string) {
  const resolve = (artifactPath: string) => path.relative(outDir, path.join(runDir, 'results', artifactPath));
  const steps = attempt.steps ?? [];
  const lastJudgment = steps.toReversed().find((step) => step.api === 'agent.assert' || step.api === 'agent.waitFor');
  const screenshot =
    (lastJudgment && (attempt.artifacts ?? []).find((a) => a.kind === 'screenshot' && a.producer?.stepId === lastJudgment.id)) ??
    (attempt.artifacts ?? []).toReversed().find((a) => a.kind === 'screenshot');
  const video = (attempt.artifacts ?? []).find((a) => a.kind === 'video');
  // e2e writes the trace page per test, beside its attempt dirs: results/<test>/trace.md.
  const testDir = (attempt.artifacts ?? []).find((a) => a.path)?.path?.split('/')[0];
  const trace = testDir !== undefined ? path.join(testDir, 'trace.md') : undefined;
  return {
    ...(screenshot?.path ? { screenshot: resolve(screenshot.path) } : {}),
    ...(video?.path ? { video: resolve(video.path) } : {}),
    ...(trace !== undefined && existsSync(path.join(runDir, 'results', trace)) ? { trace: resolve(trace) } : {}),
  };
}

/**
 * How one test fared under one mutant (README, "How it works", step 4):
 * - not reached: the bug never applied;
 * - caught / timed out: the test failed at or after the step where the bug first applied;
 * - failed before: it failed before the bug applied (noise; the drill reruns it);
 * - healed past: it passed, and an `agent.act` that replayed fully in the baseline did not;
 * - got through: it passed with the bug applied, and nothing healed;
 * - flaky: its attempts disagreed (a test's own `retries` can outrank `--retries 0`).
 */
export function classifyTest(
  result: E2EResult,
  baseline: BaselineTest,
  mutant: Mutant,
  runDir: string,
  outDir: string,
): TestVerdict {
  const attempt = finalAttempt(result);
  const base = { test: baseline.key, title: baseline.title, healed: [] as HealedStep[], passedJudgments: [] as string[] };
  // A test that never ran (its setup failed, say) was not reached by the bug. e2e records no attempt for it.
  if (result.status === 'skipped') return { ...base, outcome: 'not-reached' };
  if (!attempt) return { ...base, outcome: 'error' };
  const artifacts = artifactsOf(attempt, runDir, outDir);
  const statuses = new Set((result.attempts ?? []).map((a) => a.status));
  const appliedAtStep = firstAppliedStep(attempt, mutant.id);
  const applied = appliedAtStep !== undefined ? { appliedAtStep } : {};

  if (statuses.size > 1) return { ...base, ...applied, ...artifacts, outcome: 'flaky' };

  if (result.status === 'passed') {
    const firstSeen = firstApplied(attempt, mutant.id);
    if (firstSeen === undefined) return { ...base, ...artifacts, outcome: 'not-reached' };
    // Only steps that could have seen the bug: a hand-off that ended before it applied was about something else.
    const healed: HealedStep[] = [];
    for (const step of attempt.steps ?? []) {
      if (step.api !== 'agent.act' || !sawBug(step, firstSeen)) continue;
      const before = baseline.steps.find((s) => s.index === step.index && s.label === (step.label ?? ''));
      if (before?.cacheMode !== 'self-finalized' || step.cache?.mode === 'self-finalized') continue;
      healed.push({
        index: step.index,
        label: step.label ?? '',
        ...(step.cache?.reason !== undefined ? { reason: step.cache.reason } : {}),
        ...(step.cache?.detail !== undefined ? { detail: step.cache.detail } : {}),
        durationMs: step.durationMs ?? 0,
        baselineMs: before.durationMs,
      });
    }
    const passedJudgments = (attempt.steps ?? [])
      .filter((step) => step.api === 'agent.assert' && step.status === 'passed' && sawBug(step, firstSeen))
      .map((step) => step.label ?? '');
    return { ...base, ...applied, ...artifacts, healed, passedJudgments, outcome: healed.length > 0 ? 'healed-past' : 'got-through' };
  }

  if (!FAILED.has(result.status)) return { ...base, ...applied, ...artifacts, outcome: 'error' };
  const { outcome, failing } = readFailure(attempt, result.status, mutant.id);
  if (outcome === 'failed-before') return { ...base, ...applied, ...artifacts, outcome };
  return { ...base, ...applied, ...artifacts, outcome, ...failedStepOf(failing), ...failureOf(attempt, failing) };
}

/** Test outcomes from the one that says most about the bug to the one that says least, as {@link mutantOutcome} ranks them. */
const STRENGTH: readonly TestOutcome[] = ['caught', 'timed-out', 'healed-past', 'got-through', 'flaky', 'failed-before', 'error', 'not-reached'];

/** Rolls test verdicts into one mutant outcome: any catch catches it, then healed past, got through, noise, not reached. */
export function mutantOutcome(tests: readonly TestVerdict[]): MutantOutcome {
  const has = (outcome: TestOutcome) => tests.some((test) => test.outcome === outcome);
  if (has('caught') || has('timed-out')) return 'caught';
  if (has('healed-past')) return 'healed-past';
  if (has('got-through')) return 'got-through';
  if (has('flaky')) return 'flaky';
  if (has('failed-before')) return 'inconclusive';
  if (has('error')) return 'error';
  return 'not-reached';
}

/**
 * Classifies every selected test in a mutant run's report. A test missing from
 * the report is an error. e2e also runs the setup tests the selected tests
 * need; a setup that fails after the bug applied caught it (its dependents
 * then never run), so it is reported as a catch of its own. One that failed
 * before is noise, reported as such, so the bug is rerun.
 */
export function classifyRun(
  report: E2EReport | undefined,
  mutant: Mutant,
  baseline: ReadonlyMap<string, BaselineTest>,
  runDir: string,
  outDir: string,
): TestVerdict[] {
  const verdicts = mutant.tests.flatMap((key) => {
    const test = baseline.get(key);
    if (!test) return [];
    // Tests that share a line run as one unit (e2e selects by file:line): the strongest verdict among them stands.
    const results = report?.run.results.filter((r) => resultKey(r) === key) ?? [];
    if (results.length === 0) return [{ test: key, title: test.title, outcome: 'error' as const, healed: [], passedJudgments: [] }];
    const [strongest] = results.map((result) => classifyTest(result, test, mutant, runDir, outDir)).toSorted((a, b) => STRENGTH.indexOf(a.outcome) - STRENGTH.indexOf(b.outcome));
    return strongest ? [strongest] : [];
  });
  for (const result of report?.run.results ?? []) {
    if (result.kind !== 'setup' || !FAILED.has(result.status)) continue;
    const attempt = finalAttempt(result);
    if (!attempt) continue;
    // A setup that failed before the bug applied is noise: kept, so the bug counts as inconclusive and is rerun.
    const { outcome, failing } = readFailure(attempt, result.status, mutant.id);
    const title = `${result.titlePath?.join(' › ') ?? result.id} (setup)`;
    verdicts.push({
      test: `setup:${resultKey(result) ?? result.id}`,
      title,
      outcome,
      ...(firstAppliedStep(attempt, mutant.id) !== undefined ? { appliedAtStep: firstAppliedStep(attempt, mutant.id)! } : {}),
      ...artifactsOf(attempt, runDir, outDir),
      ...failedStepOf(failing),
      ...failureOf(attempt, failing),
      healed: [],
      passedJudgments: [],
    });
  }
  return verdicts;
}
