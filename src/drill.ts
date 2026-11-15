import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBaseline, type Baseline } from './baseline.ts';
import type { ProjectContext } from './e2e.ts';
import { candidateMutants, inertControls, selectMutants } from './operators.ts';
import { pool, runMutant, type MutantRun, type RunContext } from './runner.ts';
import { suggest } from './suggest.ts';
import type { BugType, Mutant, MutantOutcome, MutantVerdict } from './types.ts';

export interface DrillOptions {
  readonly project: ProjectContext;
  readonly files: readonly string[];
  /** Output dir relative to the project root, kept apart from e2e's `.e2e`. */
  readonly out: string;
  /** The user's replay cache dir, relative to the project root. Only ever read and copied. */
  readonly userCacheDir: string;
  readonly maxMutants: number;
  readonly types?: readonly BugType[];
  readonly concurrency: number;
  readonly ignoreFile: string;
  readonly budgetUsd?: number;
  readonly confirm: boolean;
  readonly video: boolean;
  readonly log: (line: string) => void;
}

export interface TestScore {
  readonly key: string;
  readonly title: string;
  readonly caught: number;
  readonly missed: number;
}

export interface DrillResult {
  readonly startedAt: string;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly baseline: Pick<Baseline, 'skipped' | 'costUsd' | 'durationMs'> & { readonly tests: ReadonlyArray<{ key: string; title: string }> };
  readonly candidates: number;
  readonly ignored: number;
  /** Controls the tests clicked with no click listener, `onclick` or default action: no dead-control bug was planted on them. */
  readonly inertControls?: readonly string[];
  readonly notRun: readonly Mutant[];
  readonly mutants: readonly MutantVerdict[];
  readonly caught: number;
  readonly missed: number;
  readonly catchRate: number | undefined;
  readonly perTest: readonly TestScore[];
  readonly warnings: readonly string[];
}

const MISSED = new Set<MutantOutcome>(['got-through', 'healed-past']);

/** A digest of every file under `dir` (paths and contents), or 'absent'. Used to prove the user's cache was not written. */
export async function digestDir(dir: string): Promise<string> {
  if (!existsSync(dir)) return 'absent';
  const hash = createHash('sha256');
  const walk = async (current: string) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        hash.update(path.relative(dir, full));
        hash.update(await readFile(full));
      }
    }
  };
  await walk(dir);
  return hash.digest('hex');
}

/** `git status --porcelain` lines for the project, or undefined outside a git checkout. */
function gitStatus(root: string): Set<string> | undefined {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return new Set(result.stdout.split('\n').filter(Boolean));
}

async function readIgnore(file: string): Promise<Set<string>> {
  if (!existsSync(file)) return new Set();
  const entries = JSON.parse(await readFile(file, 'utf8')) as Array<string | { title: string }>;
  return new Set(entries.map((entry) => (typeof entry === 'string' ? entry : entry.title)));
}

/**
 * Per test, how many scored bugs it caught and how many passed it. A flaky or
 * inconclusive bug is left out: its runs disagree, so it says nothing about the test.
 */
export function scoreTests(tests: ReadonlyArray<{ key: string; title: string }>, verdicts: readonly MutantVerdict[]): TestScore[] {
  return tests.map((test) => {
    let caught = 0;
    let missed = 0;
    for (const verdict of verdicts) {
      if (verdict.outcome !== 'caught' && !MISSED.has(verdict.outcome)) continue;
      const mine = verdict.tests.find((t) => t.test === test.key);
      if (mine?.outcome === 'caught' || mine?.outcome === 'timed-out') caught += 1;
      else if (mine?.outcome === 'got-through' || mine?.outcome === 'healed-past') missed += 1;
    }
    return { key: test.key, title: test.title, caught, missed };
  });
}

/**
 * Folds a confirm run into the first: both missing stays missed (healed past
 * if either healed, with that run's details); a catch against a miss is flaky;
 * noise takes the rerun.
 */
export function confirmOutcome(first: MutantRun, second: MutantRun): { outcome: MutantOutcome; run: MutantRun } {
  if (first.outcome === 'inconclusive') return { outcome: second.outcome, run: second };
  if (MISSED.has(first.outcome) && MISSED.has(second.outcome)) {
    if (first.outcome === 'healed-past') return { outcome: 'healed-past', run: first };
    return second.outcome === 'healed-past' ? { outcome: 'healed-past', run: second } : { outcome: 'got-through', run: first };
  }
  return { outcome: 'flaky', run: first };
}

/**
 * The whole drill: preflight, baseline, mutants, runs, confirm
 * runs, postflight. Everything it writes is under `out`; the user's cache and
 * working tree are checked before and after, and any change is a warning.
 */
export async function drill(options: DrillOptions): Promise<DrillResult> {
  const { project, log } = options;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const warnings: string[] = [];
  const outAbs = path.join(project.root, options.out);
  await mkdir(outAbs, { recursive: true });

  // Step 0: preflight.
  const userCache = path.join(project.root, options.userCacheDir);
  const cacheDigest = await digestDir(userCache);
  const statusBefore = gitStatus(project.root);

  // Steps 1-2: baseline.
  const baseline = await buildBaseline(project, { files: options.files, out: options.out, userCacheDir: options.userCacheDir, log });
  for (const skipped of baseline.skipped) log(`  skipped "${skipped.title}": ${skipped.reason}`);
  if (baseline.tests.length === 0) throw new Error('No test passed the baseline; nothing to drill.');
  const byKey = new Map(baseline.tests.map((test) => [test.key, test]));

  // Step 3: mutants.
  const ignore = await readIgnore(path.join(project.root, options.ignoreFile));
  const candidates = candidateMutants(baseline.tests);
  const ignored = candidates.filter((c) => ignore.has(c.title)).length;
  const mutants = selectMutants(candidates, { max: options.maxMutants, ...(options.types ? { types: options.types } : {}), ignore });
  log(`Planting ${mutants.length} bugs (${candidates.length} found, ${ignored} ignored), ${options.concurrency} at a time…`);

  // Steps 4-6: run, classify, confirm.
  const ctx: RunContext = { project, out: options.out, baselineCache: baseline.cacheDir, baseline: byKey, video: options.video };
  let spent = baseline.costUsd;
  const overBudget = () => options.budgetUsd !== undefined && spent >= options.budgetUsd;
  const verdicts = await pool(
    mutants,
    options.concurrency,
    async (mutant): Promise<MutantVerdict> => {
      const first = await runMutant(ctx, mutant);
      spent += first.costUsd;
      let outcome = first.outcome;
      let run = first;
      let confirmedBy: MutantOutcome | undefined;
      let durationMs = first.durationMs;
      let costUsd = first.costUsd;
      if (options.confirm && (MISSED.has(first.outcome) || first.outcome === 'inconclusive') && !overBudget()) {
        const second = await runMutant(ctx, mutant, 'confirm');
        spent += second.costUsd;
        ({ outcome, run } = confirmOutcome(first, second));
        confirmedBy = second.outcome;
        durationMs += second.durationMs;
        costUsd += second.costUsd;
      }
      const symbol = outcome === 'caught' ? '✓' : MISSED.has(outcome) ? '✗' : '·';
      log(`  ${symbol} ${outcome.padEnd(12)} ${mutant.title}`);
      return {
        mutant,
        outcome,
        tests: run.tests,
        durationMs,
        costUsd,
        runDir: run.runDir,
        ...(confirmedBy !== undefined ? { confirmedBy } : {}),
        suggestions: suggest(mutant, outcome, run.tests),
      };
    },
    overBudget,
  );
  const ran = new Set(verdicts.map((v) => v.mutant.id));
  const notRun = mutants.filter((m) => !ran.has(m.id));
  if (notRun.length > 0) warnings.push(`Stopped at the $${options.budgetUsd} budget: ${notRun.length} bugs were not run.`);
  const ordered = mutants.flatMap((m) => verdicts.filter((v) => v.mutant.id === m.id));

  // Step 7: postflight.
  if ((await digestDir(userCache)) !== cacheDigest) warnings.push(`The user's cache at ${options.userCacheDir} changed during the drill.`);
  const statusAfter = gitStatus(project.root);
  if (statusBefore && statusAfter) {
    // git prints paths from the repository root; the project may sit below it.
    const prefix = spawnSync('git', ['rev-parse', '--show-prefix'], { cwd: project.root, encoding: 'utf8' }).stdout.trim();
    const outPath = path.posix.join(prefix, options.out.replace(/\/$/, ''));
    for (const line of statusAfter) {
      const file = line.slice(3);
      if (!statusBefore.has(line) && file !== outPath && !file.startsWith(`${outPath}/`)) {
        warnings.push(`A file changed outside ${options.out} during the drill: ${line}`);
      }
    }
  }

  const caught = ordered.filter((v) => v.outcome === 'caught').length;
  const missed = ordered.filter((v) => MISSED.has(v.outcome)).length;
  const perTest = scoreTests(baseline.tests, ordered);

  const result: DrillResult = {
    startedAt,
    durationMs: Date.now() - started,
    costUsd: spent,
    baseline: {
      tests: baseline.tests.map(({ key, title }) => ({ key, title })),
      skipped: baseline.skipped,
      costUsd: baseline.costUsd,
      durationMs: baseline.durationMs,
    },
    candidates: candidates.length,
    ignored,
    inertControls: inertControls(baseline.tests),
    notRun,
    mutants: ordered,
    caught,
    missed,
    catchRate: caught + missed > 0 ? caught / (caught + missed) : undefined,
    perTest,
    warnings,
  };
  await writeFile(path.join(outAbs, 'drill.json'), JSON.stringify(result, null, 2));
  return result;
}
