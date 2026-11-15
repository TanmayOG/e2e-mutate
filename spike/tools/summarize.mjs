/**
 * Prints what the spike needs from one run's report.json: each test's status,
 * every step (kind, api, label, status, error code, cache mode and reason,
 * start time), the attempt's app-log lines, and usage. Usage:
 *   node tools/summarize.mjs runs/<run-name>
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
const run = report.run ?? report;

for (const result of run.results ?? []) {
  console.log(`\n# ${result.titlePath?.join(' › ') ?? result.id} — ${result.status}`);
  for (const attempt of result.attempts ?? []) {
    console.log(`  attempt ${attempt.index} ${attempt.status} start=${attempt.startedAt} ${attempt.durationMs}ms`);
    for (const step of attempt.steps ?? []) {
      const cache = step.cache
        ? ` cache=${step.cache.mode}${step.cache.reason ? `/${step.cache.reason}` : ''} replayed=${step.cache.replayedActions ?? '-'}/${step.cache.totalActions ?? '-'}${step.cache.write ? ` write=${step.cache.write}` : ''}`
        : '';
      const error = step.error ? ` error=${step.error.code}: ${String(step.error.message ?? '').slice(0, 160)}` : '';
      const usage = step.metrics?.estimatedCostUsd !== undefined ? ` $${step.metrics.estimatedCostUsd}` : '';
      console.log(`    [${step.index}] ${step.kind}/${step.api} "${step.label ?? ''}" ${step.status} start=${step.startedAt}${cache}${error}${usage}`);
      if (step.cache?.detail) console.log(`        detail: ${String(step.cache.detail).slice(0, 300)}`);
    }
    for (const line of attempt.appLog ?? []) {
      console.log(`    log step=${line.step ?? '-'} ${line.source}/${line.level}: ${line.text}`);
    }
  }
}
const summary = run.summary ?? {};
console.log('\nsummary:', JSON.stringify(summary).slice(0, 600));
