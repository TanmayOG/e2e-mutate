import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startCollector } from './collector.ts';
import { freshCopy, listTests, runE2E, type ListedPair, type ProjectContext } from './e2e.ts';
import { finalAttempt, readReport, resultKey, type E2EReport, type E2EResult } from './report-json.ts';
import { writeRecorderScript } from './scripts.ts';
import type { BaselineStep, BaselineTest, RecorderEvent, SkippedTest, TestRef } from './types.ts';

export interface Baseline {
  readonly tests: readonly BaselineTest[];
  readonly skipped: readonly SkippedTest[];
  /** The recorded cache every mutant run copies, relative to the project root. */
  readonly cacheDir: string;
  readonly costUsd: number;
  readonly durationMs: number;
}

export interface BaselineOptions {
  readonly files: readonly string[];
  /** The drill's output directory, relative to the project root. */
  readonly out: string;
  /** The user's cache directory, relative to the project root. It is only ever copied. */
  readonly userCacheDir: string;
  readonly log: (line: string) => void;
}

const RECORDED_WRITES = new Set(['saved', 'kept']);

/**
 * Matches recorder events to tests by time. The record run uses one worker, so
 * attempts never overlap: an event belongs to the latest attempt that started
 * at or before it. Tests run a few milliseconds apart, so a fixed window
 * around each attempt would hand one test's events to its neighbor; this rule
 * doesn't. An event from a page-hide flush lands before the next attempt
 * starts, so it stays with the test that produced it.
 */
export function attributeEvents(report: E2EReport, events: readonly RecorderEvent[]): Map<string, RecorderEvent[]> {
  const starts = report.run.results
    .flatMap((result) => {
      const key = resultKey(result);
      return key === undefined ? [] : (result.attempts ?? []).map((attempt) => ({ key, start: Date.parse(attempt.startedAt) }));
    })
    .toSorted((a, b) => a.start - b.start);
  const byKey = new Map<string, RecorderEvent[]>();
  for (const event of events) {
    let owner: string | undefined;
    for (const attempt of starts) {
      if (attempt.start > event.at) break;
      owner = attempt.key;
    }
    if (owner === undefined) continue;
    const list = byKey.get(owner) ?? [];
    list.push(event);
    byKey.set(owner, list);
  }
  return byKey;
}

/**
 * Builds the baseline the drill compares against:
 * 1. list the tests, leaving out serial groups, skipped tests, and tests with no source line;
 * 2. copy the user's cache, then run every test once with the recorder injected, recording
 *    agent steps into that copy (a test must pass, and its agent steps must be recorded);
 * 3. replay from a fresh copy: a test must pass again, and every `agent.act` must replay fully
 *    (`cache.mode: 'self-finalized'`), or it is left out as unstable.
 * The recorder's events are matched to tests by time: the record run uses one worker.
 */
/**
 * The units the drill runs. e2e selects tests by `file:line`, so tests that
 * share a line (made in a loop) always run together; they are one unit, under
 * the first one's title. Tests e2e won't run, serial groups and tests with no
 * source line are left out, with the reason.
 */
export function drillUnits(pairs: readonly ListedPair[]): { units: TestRef[]; skipped: SkippedTest[] } {
  const skipped: SkippedTest[] = [];
  const byKey = new Map<string, { ref: TestRef; count: number; target: string | undefined }>();
  const skip = (title: string, reason: string) => {
    // e2e lists a test once per target; one entry says enough.
    if (!skipped.some((entry) => entry.title === title && entry.reason === reason)) skipped.push({ title, reason });
  };
  for (const pair of pairs) {
    if (pair.kind !== 'test') continue;
    if (pair.disposition !== undefined && pair.disposition !== 'run') {
      skip(pair.title, `e2e won't run it (${pair.disposition})`);
    } else if (pair.serialId !== undefined) {
      skip(pair.title, 'serial groups are not supported yet');
    } else if (!pair.source) {
      skip(pair.title, 'e2e reported no source line for it');
    } else {
      const key = `${pair.source.file}:${pair.source.line}`;
      const unit = byKey.get(key);
      // Count the tests on the line for one target: e2e lists each test once per target.
      if (unit) unit.count += pair.target === unit.target ? 1 : 0;
      else byKey.set(key, { ref: { key, file: pair.source.file, line: pair.source.line, title: pair.title }, count: 1, target: pair.target });
    }
  }
  const units = [...byKey.values()].map(({ ref, count }) => (count > 1 ? { ...ref, title: `${ref.title} (${count} tests on this line)` } : ref));
  return { units, skipped };
}

/** A report's results grouped by `file:line`, in report order. */
export function resultsByKey(report: E2EReport): Map<string, E2EResult[]> {
  const byKey = new Map<string, E2EResult[]>();
  for (const result of report.run.results) {
    const key = resultKey(result);
    if (key === undefined) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), result]);
  }
  return byKey;
}

/** Why a unit's record run can't serve as its baseline, or undefined when every test in it passed and recorded its agent steps. */
export function notRecorded(results: readonly E2EResult[]): string | undefined {
  for (const result of results) {
    const attempt = finalAttempt(result);
    if (result.status !== 'passed' || !attempt) return notRecordedReason(result.status);
    const unrecorded = (attempt.steps ?? []).find((step) => step.api === 'agent.act' && !RECORDED_WRITES.has(step.cache?.write ?? ''));
    if (unrecorded) {
      return `its agent step "${unrecorded.label ?? ''}" was not recorded (cache.write ${unrecorded.cache?.write ?? 'missing'}); is the cache off, read-only, or strict in the config?`;
    }
  }
  return undefined;
}

/** A unit's baseline steps from its replay run: every test in it passed again and every `agent.act` replayed fully, or why not. */
export function replayedSteps(results: readonly E2EResult[]): { steps: BaselineStep[] } | { reason: string } {
  if (results.length === 0) return { reason: 'missing from the replay run' };
  const steps: BaselineStep[] = [];
  for (const result of results) {
    const attempt = finalAttempt(result);
    if (result.status !== 'passed' || !attempt) return { reason: `failed when replayed (${result.status})` };
    for (const step of attempt.steps ?? []) {
      const cacheMode = step.cache?.mode;
      if (step.api === 'agent.act' && cacheMode !== 'self-finalized') {
        return { reason: `its agent step "${step.label ?? ''}" did not replay cleanly (${cacheMode ?? 'no cache'})` };
      }
      steps.push({ index: step.index, kind: step.kind, api: step.api, label: step.label ?? '', ...(cacheMode !== undefined ? { cacheMode } : {}), durationMs: step.durationMs ?? 0 });
    }
  }
  return { steps };
}

/** Why a test that did not pass its baseline record run is left out of the drill. */
export function notRecordedReason(status: string): string {
  return status === 'skipped' ? 'skipped in the baseline record run' : `${status} in the baseline record run, with the recorder on`;
}

export async function buildBaseline(project: ProjectContext, options: BaselineOptions): Promise<Baseline> {
  const started = Date.now();
  const skipped: SkippedTest[] = [];
  const listed = drillUnits(await listTests(project, options.files));
  const candidates = listed.units;
  skipped.push(...listed.skipped);
  if (candidates.length === 0) throw new Error('No tests to drill.');

  const cacheDir = path.join(options.out, 'cache', 'baseline');
  await freshCopy(path.join(project.root, options.userCacheDir), path.join(project.root, cacheDir));

  // Record: one worker, recorder on, writes into the baseline cache copy.
  options.log(`Baseline: recording ${candidates.length} tests (one at a time, recorder on)…`);
  const collector = await startCollector();
  let recordReport: E2EReport | undefined;
  try {
    const script = await writeRecorderScript(path.join(project.root, options.out, 'scripts'), collector.endpoint);
    const recordOut = path.join(options.out, 'runs', 'baseline-record');
    await runE2E(project, { files: candidates.map((t) => t.key), output: recordOut, cacheDir, script, workers: 1, video: false });
    recordReport = await readReport(path.join(project.root, recordOut));
    // Beacons sent at page hide can land just after the run ends.
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    await collector.close();
  }
  if (!recordReport) throw new Error(`The baseline record run wrote no report. See ${options.out}/runs/baseline-record.log`);
  await writeFile(path.join(project.root, options.out, 'baseline-events.json'), JSON.stringify(collector.events, null, 2));
  if (collector.events.length === 0) {
    const pageErrors = recordReport.run.results
      .flatMap((result) => finalAttempt(result)?.appLog ?? [])
      .filter((line) => line.source === 'error')
      .map((line) => line.text);
    throw new Error(
      `The recorder sent nothing during the baseline, so no bugs can be planted. Is \`...mutate()\` in the config's web({ initScripts })?` +
        (pageErrors.length > 0 ? ` Page errors: ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}` : ''),
    );
  }

  const eventsByKey = attributeEvents(recordReport, collector.events);
  const recorded = new Map<string, { test: TestRef; events: RecorderEvent[] }>();
  const recordedResults = resultsByKey(recordReport);
  for (const test of candidates) {
    const results = recordedResults.get(test.key);
    if (!results) {
      skipped.push({ ...test, reason: 'missing from the baseline record run' });
      continue;
    }
    const reason = notRecorded(results);
    if (reason !== undefined) {
      skipped.push({ ...test, reason });
      continue;
    }
    recorded.set(test.key, { test, events: eventsByKey.get(test.key) ?? [] });
  }

  // Replay: a fresh copy of the recorded cache, no script. Every act must replay fully.
  options.log(`Baseline: replaying ${recorded.size} tests to check they are stable…`);
  const replayCache = path.join(options.out, 'cache', 'baseline-replay');
  await freshCopy(path.join(project.root, cacheDir), path.join(project.root, replayCache));
  const replayOut = path.join(options.out, 'runs', 'baseline-replay');
  await runE2E(project, { files: [...recorded.keys()], output: replayOut, cacheDir: replayCache, workers: 1, video: false });
  const replayReport = await readReport(path.join(project.root, replayOut));
  if (!replayReport) throw new Error(`The baseline replay run wrote no report. See ${replayOut}.log`);

  const tests: BaselineTest[] = [];
  const replayedResults = resultsByKey(replayReport);
  for (const [key, entry] of recorded) {
    const replayed = replayedSteps(replayedResults.get(key) ?? []);
    if ('reason' in replayed) {
      skipped.push({ ...entry.test, reason: replayed.reason });
      continue;
    }
    tests.push({ ...entry.test, steps: replayed.steps, events: entry.events });
  }
  await rm(path.join(project.root, replayCache), { recursive: true, force: true });

  const costUsd = (recordReport.run.usage?.estimatedCostUsd ?? 0) + (replayReport.run.usage?.estimatedCostUsd ?? 0);
  return { tests, skipped, cacheDir, costUsd, durationMs: Date.now() - started };
}
