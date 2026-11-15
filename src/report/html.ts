import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DrillResult } from '../drill.ts';
import type { MutantOutcome, MutantVerdict, TestVerdict } from '../types.ts';
import { relevantMisses } from '../relevance.ts';
import { explain } from './terminal.ts';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Escapes text, then turns `inline code` into <code>. */
const prose = (text: string) => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const href = (relative: string) => relative.split(path.sep).map(encodeURIComponent).join('/');
const seconds = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const shortSeconds = (ms: number) => (ms < 1000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 1000).toFixed(1)}s`);

const CHIP: Record<MutantOutcome, { label: string; tone: string }> = {
  caught: { label: 'caught', tone: 'good' },
  'healed-past': { label: 'healed past', tone: 'warn' },
  'got-through': { label: 'got through', tone: 'bad' },
  'not-reached': { label: 'not reached', tone: 'muted' },
  inconclusive: { label: 'inconclusive', tone: 'muted' },
  flaky: { label: 'flaky', tone: 'muted' },
  error: { label: 'error', tone: 'muted' },
};
const chip = (outcome: MutantOutcome) => `<span class="chip ${CHIP[outcome].tone}">${CHIP[outcome].label}</span>`;

function missedTest(test: TestVerdict): string {
  const parts: string[] = [];
  if (test.outcome === 'healed-past') {
    for (const step of test.healed) {
      const slower = step.baselineMs > 0 ? ` — ${shortSeconds(step.durationMs)} instead of ${shortSeconds(step.baselineMs)} replayed` : '';
      parts.push(
        `<p><strong>${escapeHtml(test.title)}</strong> passed: the agent took over <code>agent.act(${escapeHtml(JSON.stringify(step.label))})</code>${slower}.</p>`,
      );
      if (step.detail) parts.push(`<p class="detail">Replay stopped (${escapeHtml(step.reason ?? 'unknown')}): ${escapeHtml(step.detail)}</p>`);
    }
  } else {
    const judgment = test.passedJudgments[0];
    parts.push(
      `<p><strong>${escapeHtml(test.title)}</strong> passed${judgment ? `: <code>agent.assert(${escapeHtml(JSON.stringify(judgment))})</code> passed after the bug appeared` : ' with the bug in place'}.</p>`,
    );
  }
  const links = [
    test.video ? `<a href="${href(test.video)}">video</a>` : '',
    test.trace ? `<a href="${href(test.trace)}">trace</a>` : '',
  ].filter(Boolean);
  if (links.length > 0) parts.push(`<p class="links">${links.join(' · ')}</p>`);
  return parts.join('');
}

/**
 * What the bug changed from. An element's recorded text can be a loading
 * placeholder ("…") captured before the page filled it in; show the element's
 * name then, rather than punctuation.
 */
export function beforeLabel(verdict: Pick<MutantVerdict, 'mutant'>): string {
  const { before, element } = verdict.mutant;
  if (/[\p{L}\p{N}]/u.test(before)) return before;
  return element?.testId !== undefined ? `the ${element.testId.replace(/[-_]+/g, ' ')}` : 'the element';
}

function missedCard(verdict: MutantVerdict): string {
  const all = relevantMisses(verdict.tests);
  // Lead with the tests that explain the miss; tests that only passed through the page go on one line.
  const lead = all.filter((t, i) => i === 0 || t.outcome === 'healed-past' || t.passedJudgments.length > 0).slice(0, 2);
  const rest = all.filter((t) => !lead.includes(t));
  const tests = lead;
  const shot = lead.find((t) => t.screenshot)?.screenshot ?? rest.find((t) => t.screenshot)?.screenshot;
  return `<article class="card">
  <header><h3>${escapeHtml(verdict.mutant.title)}</h3>${chip(verdict.outcome)}</header>
  <div class="card-body">
    <div class="card-text">
      <p class="change"><span class="was">${escapeHtml(beforeLabel(verdict))}</span> → <span class="now">${escapeHtml(verdict.mutant.after)}</span> <span class="type">${escapeHtml(verdict.mutant.type)}</span></p>
      ${tests.map(missedTest).join('\n')}
      ${rest.length > 0 ? `<p class="meta">Also passed with the bug in place: ${rest.map((t) => escapeHtml(t.title)).join(', ')}.</p>` : ''}
      ${verdict.suggestions.length > 0 ? `<div class="fix"><h4>Make a test catch it</h4>${verdict.suggestions.map((s) => `<p>${prose(s)}</p>`).join('')}</div>` : ''}
      <p class="meta">${verdict.confirmedBy ? `Confirmed by a second run (${CHIP[verdict.confirmedBy].label}). ` : ''}Run: <a href="${href(verdict.runDir)}.log">log</a> · ${shortSeconds(verdict.durationMs)} · $${verdict.costUsd.toFixed(3)}</p>
    </div>
    ${shot ? `<a class="shot" href="${href(shot)}"><img src="${href(shot)}" alt="The screen the test saw with the bug planted"></a>` : ''}
  </div>
</article>`;
}

/** Writes the drill as one self-contained HTML page next to its runs, and returns its path. */
export async function writeHtmlReport(result: DrillResult, outDir: string): Promise<string> {
  const missed = result.mutants
    .filter((v) => v.outcome === 'healed-past' || v.outcome === 'got-through')
    .toSorted((a, b) => (a.outcome === b.outcome ? 0 : a.outcome === 'healed-past' ? -1 : 1));
  const caught = result.mutants.filter((v) => v.outcome === 'caught');
  const unscored = result.mutants.filter((v) => !['caught', 'healed-past', 'got-through'].includes(v.outcome));
  const rate = result.catchRate === undefined ? '—' : `${Math.round(result.catchRate * 100)}%`;
  const healedCount = result.mutants.filter((v) => v.outcome === 'healed-past').length;
  const reachedTests = result.perTest.filter((t) => t.caught + t.missed > 0);
  const unreachedTests = result.perTest.length - reachedTests.length;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>e2e-mutate drill</title>
<style>
  :root { --bg: #fbfaf8; --panel: #ffffff; --ink: #1d1b19; --muted: #6f6a64; --line: #e8e4de;
          --good: #17663a; --good-bg: #e3f4e8; --bad: #a3271f; --bad-bg: #fbe5e2; --warn: #8a4b00; --warn-bg: #fdf0d8;
          --code-bg: #f3f0eb; --accent: #9a3412; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #151413; --panel: #1e1c1a; --ink: #eeebe7; --muted: #a39d96; --line: #34302c;
            --good: #7fd49b; --good-bg: #183323; --bad: #f19a90; --bad-bg: #3a1c19; --warn: #f2bd6b; --warn-bg: #3a2a12;
            --code-bg: #2a2724; --accent: #f08a5d; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 40px 0 12px; }
  h3 { font-size: 15px; margin: 0; }
  h4 { font-size: 13px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .hero { display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 24px 28px; }
  .rate { font-size: 56px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .rate small { display: block; font-size: 14px; font-weight: 500; color: var(--muted); letter-spacing: 0; margin-top: 6px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px 28px; color: var(--muted); }
  .stats b { color: var(--ink); font-weight: 600; }
  .callout { margin-top: 10px; color: var(--warn); }
  .chip { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
  .chip.good { color: var(--good); background: var(--good-bg); } .chip.bad { color: var(--bad); background: var(--bad-bg); }
  .chip.warn { color: var(--warn); background: var(--warn-bg); } .chip.muted { color: var(--muted); background: var(--code-bg); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 14px; overflow: hidden; }
  .card > header { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  .card-body { display: grid; grid-template-columns: 1fr 300px; gap: 18px; padding: 14px 18px; }
  .card-body p { margin: 0 0 8px; }
  .shot img { width: 100%; border: 1px solid var(--line); border-radius: 8px; display: block; }
  .change { font-variant-numeric: tabular-nums; }
  .was { text-decoration: line-through; color: var(--muted); } .now { font-weight: 600; }
  .type { margin-left: 8px; font-size: 12px; color: var(--muted); }
  .detail { color: var(--muted); font-size: 13px; }
  .fix { background: var(--code-bg); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
  .fix p:last-child { margin-bottom: 0; }
  .meta, .links { font-size: 13px; color: var(--muted); }
  code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
  .fix code { background: var(--panel); }
  a { color: var(--accent); }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 14px; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  .bar { height: 8px; border-radius: 4px; background: var(--bad-bg); overflow: hidden; min-width: 120px; }
  .bar span { display: block; height: 100%; background: var(--good); }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  footer { margin-top: 40px; color: var(--muted); font-size: 13px; }
  @media (max-width: 760px) { .hero, .card-body { grid-template-columns: 1fr; } .rate { font-size: 44px; } }
</style>
</head>
<body>
<main>
  <h1>Would your tests catch these bugs?</h1>
  <p class="sub">e2e-mutate planted ${result.mutants.length} bugs in the running app, one at a time, and reran the tests that touch each one · ${escapeHtml(new Date(result.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</p>

  <section class="hero">
    <div class="rate">${rate}<small>${result.caught} of ${result.caught + result.missed} bugs caught</small></div>
    <div>
      <div class="stats">
        <span><b>${result.missed - healedCount}</b> got through</span>
        <span><b>${healedCount}</b> healed past by the agent</span>
        <span><b>${result.baseline.tests.length}</b> tests</span>
        <span><b>${seconds(result.durationMs)}</b></span>
        <span><b>$${result.costUsd.toFixed(2)}</b> estimated model cost</span>
      </div>
      ${healedCount > 0 ? `<p class="callout">“Healed past” means the test passed because the agent found another way around the bug. Self-healing kept the test green while the app was broken.</p>` : ''}
    </div>
  </section>

  <h2>Bugs your tests missed (${missed.length})</h2>
  ${missed.length > 0 ? missed.map(missedCard).join('\n') : '<p>None. Every bug that reached a test was caught.</p>'}

  <h2>By test</h2>
  <p class="meta">Of the bugs that reached each test, how many it caught. A test that only passes through a page also counts the bugs on that page that are someone else's job, so a low share here is a place to look, not a failing grade.</p>
  <table>
    <thead><tr><th>Test</th><th class="num">Caught</th><th class="num">Passed with the bug</th><th>Share caught</th></tr></thead>
    <tbody>
    ${reachedTests
      .map((t) => {
        const pct = Math.round((t.caught / (t.caught + t.missed)) * 100);
        return `<tr><td>${escapeHtml(t.title)}<br><span class="meta">${escapeHtml(t.key)}</span></td><td class="num">${t.caught}</td><td class="num">${t.missed}</td><td><div class="bar" title="${pct}%"><span style="width:${pct}%"></span></div><span class="meta">${pct}%</span></td></tr>`;
      })
      .join('\n')}
    </tbody>
  </table>
  ${unreachedTests > 0 ? `<p class="meta">${unreachedTests} more ${unreachedTests === 1 ? 'test' : 'tests'}: no scored bug reached ${unreachedTests === 1 ? 'it' : 'them'}.</p>` : ''}

  <h2>Caught (${caught.length})</h2>
  <table>
    <thead><tr><th>Bug</th><th>Caught by</th><th>Error</th></tr></thead>
    <tbody>
    ${caught
      .map((v) => {
        const test = v.tests.find((t) => t.outcome === 'caught' || t.outcome === 'timed-out');
        return `<tr><td>${escapeHtml(v.mutant.title)}</td><td>${escapeHtml(explain(v))}</td><td><code>${escapeHtml(test?.failedStep?.code ?? test?.failure?.code ?? test?.outcome ?? '')}</code></td></tr>`;
      })
      .join('\n')}
    </tbody>
  </table>

  ${
    unscored.length > 0
      ? `<h2>Not scored (${unscored.length})</h2>
  <table>
    <thead><tr><th>Bug</th><th>Outcome</th><th>Why</th></tr></thead>
    <tbody>
    ${unscored
      .map((v) => `<tr><td>${escapeHtml(v.mutant.title)}</td><td>${chip(v.outcome)}</td><td class="meta">${escapeHtml(v.tests.map((t) => `${t.title}: ${t.outcome}`).join('; '))} · <a href="${href(v.runDir)}.log">log</a></td></tr>`)
      .join('\n')}
    </tbody>
  </table>`
      : ''
  }

  ${
    result.baseline.skipped.length > 0
      ? `<h2>Left out of the drill</h2><table><tbody>${result.baseline.skipped.map((s) => `<tr><td>${escapeHtml(s.title)}</td><td class="meta">${escapeHtml(s.reason)}</td></tr>`).join('')}</tbody></table>`
      : ''
  }
  ${
    (result.inertControls ?? []).length > 0
      ? `<h2>Not planted</h2><p class="meta">The tests clicked these controls, but nothing listens for their clicks (no click listener on them or above them, no <code>onclick</code>) and they have no default action, so a "does nothing" bug would change nothing a test could see.</p><table><tbody>${(result.inertControls ?? []).map((label) => `<tr><td>${escapeHtml(label)}</td></tr>`).join('')}</tbody></table>`
      : ''
  }
  ${result.warnings.length > 0 ? `<h2>Warnings</h2>${result.warnings.map((w) => `<p>${escapeHtml(w)}</p>`).join('')}` : ''}

  <footer>
    <p><b>How to read this.</b> A bug is <em>caught</em> when a test that touches it fails after the bug first showed up: in a step still running then or started later, or after its last step.
    It <em>got through</em> when every such test still passed. It was <em>healed past</em> when a test passed only because an <code>agent.act</code> that replays without a model in the baseline had to hand off to the agent, which found another way.
    Bugs that got through or were healed past were run a second time and kept only if both runs agreed, unless the drill ran with <code>--no-confirm</code> or reached its budget first. <em>Not reached</em> means no test reached the place the bug lives.
    Bugs are planted in the browser at runtime; the app's source and your replay cache are never changed.</p>
    <p>Baseline: ${result.baseline.tests.length} tests recorded and replayed in ${seconds(result.baseline.durationMs)} ($${result.baseline.costUsd.toFixed(2)}). ${result.candidates} possible bugs found, ${result.ignored} ignored. Machine-readable: <a href="drill.json">drill.json</a>.</p>
  </footer>
</main>
</body>
</html>
`;
  const file = path.join(outDir, 'report.html');
  await writeFile(file, html);
  return file;
}
