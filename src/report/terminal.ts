import type { DrillResult } from '../drill.ts';
import { relevantMisses } from '../relevance.ts';
import type { MutantOutcome, MutantVerdict } from '../types.ts';

const LABEL: Record<MutantOutcome, string> = {
  caught: '✓ caught',
  'healed-past': '⚠ healed past',
  'got-through': '✗ got through',
  'not-reached': '· not reached',
  inconclusive: '? inconclusive',
  flaky: '~ flaky',
  error: '! error',
};

const seconds = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const dollars = (usd: number) => `$${usd.toFixed(2)}`;
const percent = (rate: number | undefined) => (rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

/** The one test and step that explains a verdict: the catching step, or the check that let the bug through. */
export function explain(verdict: MutantVerdict): string {
  if (verdict.outcome === 'caught') {
    const test = verdict.tests.find((t) => t.outcome === 'caught' || t.outcome === 'timed-out');
    if (!test) return '';
    const step = test.failedStep;
    if (step) return `${test.title} › ${step.api} ${JSON.stringify(step.label)}`;
    const message = test.failure?.message?.split('\n')[0];
    if (message) return `${test.title} › ${message.length > 90 ? `${message.slice(0, 89)}…` : message}`;
    return `${test.title} › ${test.outcome === 'timed-out' ? 'timed out' : 'failed'}`;
  }
  if (verdict.outcome === 'healed-past') {
    const test = verdict.tests.find((t) => t.outcome === 'healed-past');
    const step = test?.healed[0];
    return test && step ? `${test.title} › the agent took over "${step.label}" and the test passed` : '';
  }
  if (verdict.outcome === 'got-through') {
    const tests = relevantMisses(verdict.tests);
    const lead = tests[0];
    if (!lead) return '';
    const what = lead.passedJudgments[0] ? `${lead.title} › agent.assert ${JSON.stringify(lead.passedJudgments[0])} passed` : `${lead.title} passed`;
    return tests.length > 1 ? `${what} (+${tests.length - 1} more tests passed)` : what;
  }
  return verdict.tests.map((t) => `${t.title}: ${t.outcome}`).join('; ');
}

/** The drill as plain text for the terminal. */
export function renderTerminal(result: DrillResult, htmlPath?: string): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(
    `e2e-mutate · ${result.mutants.length} bugs planted · ${result.baseline.tests.length} tests · ${seconds(result.durationMs)} · ${dollars(result.costUsd)}`,
  );
  lines.push('');
  const width = Math.min(52, Math.max(...result.mutants.map((v) => v.mutant.title.length), 10));
  for (const verdict of result.mutants) {
    const title = verdict.mutant.title.length > width ? `${verdict.mutant.title.slice(0, width - 1)}…` : verdict.mutant.title.padEnd(width);
    lines.push(`${LABEL[verdict.outcome].padEnd(15)} ${title}  ${explain(verdict)}`);
  }
  lines.push('');
  const scored = result.caught + result.missed;
  lines.push(`Catch rate: ${result.caught} of ${scored} (${percent(result.catchRate)})`);
  const others = (outcome: MutantOutcome) => result.mutants.filter((v) => v.outcome === outcome).length;
  const extra = (['not-reached', 'flaky', 'inconclusive', 'error'] as const).map((o) => [o, others(o)] as const).filter(([, n]) => n > 0);
  if (extra.length > 0) lines.push(`Not scored: ${extra.map(([o, n]) => `${n} ${o}`).join(', ')}`);
  lines.push('');
  lines.push('By test (of the bugs that reached it):');
  const reached = result.perTest.filter((test) => test.caught + test.missed > 0);
  for (const test of reached) {
    lines.push(`  ${percent(test.caught / (test.caught + test.missed)).padStart(4)}  ${test.title}  (${test.caught} caught, ${test.missed} passed with the bug)`);
  }
  const unreached = result.perTest.length - reached.length;
  if (unreached > 0) lines.push(`  ${reached.length > 0 ? 'and ' : ''}${unreached} ${unreached === 1 ? 'test' : 'tests'} no scored bug reached`);
  const inert = result.inertControls ?? [];
  if (inert.length > 0) {
    lines.push('');
    lines.push(`Not planted: a "does nothing" bug on ${inert.length} clicked ${inert.length === 1 ? 'control' : 'controls'} with no click listener, onclick or default action, where it would change nothing:`);
    for (const label of inert.slice(0, 5)) lines.push(`  ${label}`);
    if (inert.length > 5) lines.push(`  and ${inert.length - 5} more (drill.json, inertControls)`);
  }
  if (result.baseline.skipped.length > 0) {
    lines.push('');
    lines.push('Left out of the drill:');
    for (const skipped of result.baseline.skipped) lines.push(`  ${skipped.title}: ${skipped.reason}`);
  }
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`);
  if (htmlPath) lines.push('', `Report: ${htmlPath}`);
  return lines.join('\n');
}
