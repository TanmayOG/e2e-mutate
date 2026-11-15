import { rm } from 'node:fs/promises';
import path from 'node:path';
import { classifyRun, mutantOutcome } from './classify.ts';
import { freshCopy, runE2E, type ProjectContext } from './e2e.ts';
import { readReport } from './report-json.ts';
import { writeMutantScript } from './scripts.ts';
import type { BaselineTest, Mutant, MutantOutcome, TestVerdict } from './types.ts';

export interface RunContext {
  readonly project: ProjectContext;
  /** The drill's output dir, relative to the project root. */
  readonly out: string;
  /** The recorded baseline cache, relative to the project root. */
  readonly baselineCache: string;
  readonly baseline: ReadonlyMap<string, BaselineTest>;
  readonly video: boolean;
}

export interface MutantRun {
  readonly tests: TestVerdict[];
  readonly outcome: MutantOutcome;
  readonly durationMs: number;
  readonly costUsd: number;
  /** Relative to the drill's output dir. */
  readonly runDir: string;
}

/**
 * Runs the tests that touch one mutant, in their own e2e process, with the
 * mutant injected, a fresh copy of the baseline cache (deleted afterwards), and
 * their own output dir. Nothing the run writes reaches the user's cache.
 */
export async function runMutant(ctx: RunContext, mutant: Mutant, tag = ''): Promise<MutantRun> {
  const { root } = ctx.project;
  const id = tag ? `${mutant.id}-${tag}` : mutant.id;
  const script = await writeMutantScript(path.join(root, ctx.out, 'scripts'), mutant);
  const cacheDir = path.join(ctx.out, 'cache', id);
  const runDir = path.join(ctx.out, 'runs', id);
  await freshCopy(path.join(root, ctx.baselineCache), path.join(root, cacheDir));
  const started = Date.now();
  try {
    await runE2E(ctx.project, { files: mutant.tests, output: runDir, cacheDir, script, workers: 1, video: ctx.video });
  } finally {
    await rm(path.join(root, cacheDir), { recursive: true, force: true });
  }
  const report = await readReport(path.join(root, runDir));
  const tests = classifyRun(report, mutant, ctx.baseline, path.join(root, runDir), path.join(root, ctx.out));
  return {
    tests,
    outcome: mutantOutcome(tests),
    durationMs: Date.now() - started,
    costUsd: report?.run.usage?.estimatedCostUsd ?? 0,
    runDir: path.relative(ctx.out, runDir),
  };
}

/** Runs `work` over `items`, at most `limit` at a time, until `stop()` says no more should start. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
  stop: () => boolean = () => false,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length && !stop()) {
      const item = items[next++]!;
      results.push(await work(item));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}
