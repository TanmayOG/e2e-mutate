import { describe, expect, it } from 'vitest';
import { attributeEvents, drillUnits, notRecorded, notRecordedReason, replayedSteps } from '../src/baseline.ts';
import type { ListedPair } from '../src/e2e.ts';
import type { E2EReport, E2EResult } from '../src/report-json.ts';
import type { RecorderEvent } from '../src/types.ts';

const iso = (ms: number) => new Date(Date.UTC(2026, 10, 15, 11, 0, 0, ms)).toISOString();
const t = (ms: number) => Date.UTC(2026, 10, 15, 11, 0, 0, ms);

const report = {
  schemaVersion: '1',
  run: {
    status: 'passed',
    exitCode: 0,
    results: [
      { id: 'b', source: { file: 'profile.e2e.ts', line: 3 }, status: 'passed', attempts: [{ index: 0, status: 'passed', startedAt: iso(1000), durationMs: 4000 }] },
      { id: 'a', source: { file: 'add.e2e.ts', line: 3 }, status: 'passed', attempts: [{ index: 0, status: 'passed', startedAt: iso(0), durationMs: 997 }] },
      { id: 'c', source: { file: 'remove.e2e.ts', line: 3 }, status: 'passed', attempts: [{ index: 0, status: 'passed', startedAt: iso(5003), durationMs: 700 }] },
    ],
  },
} satisfies E2EReport;

const text = (ms: number, label: string): RecorderEvent => ({ kind: 'text', at: t(ms), page: '/', text: label });

describe('attributeEvents', () => {
  it('gives each event to the latest test that started at or before it, so neighbors 3 ms apart never swap events', () => {
    const byKey = attributeEvents(report, [
      text(500, 'add'),
      text(999, 'add, page-hide flush after the attempt ended'),
      text(4999, 'profile'),
      text(5050, 'remove, 47 ms into the next test'),
    ]);
    expect(byKey.get('add.e2e.ts:3')?.map((e) => (e.kind === 'text' ? e.text : ''))).toEqual(['add', 'add, page-hide flush after the attempt ended']);
    expect(byKey.get('profile.e2e.ts:3')?.map((e) => (e.kind === 'text' ? e.text : ''))).toEqual(['profile']);
    expect(byKey.get('remove.e2e.ts:3')?.map((e) => (e.kind === 'text' ? e.text : ''))).toEqual(['remove, 47 ms into the next test']);
  });
  it('drops events from before the first test started', () => {
    expect([...attributeEvents(report, [text(-5, 'too early')]).values()].flat()).toEqual([]);
  });
});

describe('notRecordedReason', () => {
  it('says a skipped test was skipped, not that it failed', () => {
    expect(notRecordedReason('skipped')).toBe('skipped in the baseline record run');
  });
  it('says a failed test failed with the recorder on', () => {
    expect(notRecordedReason('failed')).toBe('failed in the baseline record run, with the recorder on');
  });
});

const pair = (title: string, line: number, extra: Partial<ListedPair> = {}): ListedPair => ({
  id: title,
  file: 'tests/click.e2e.ts',
  title,
  titlePath: [title],
  kind: 'test',
  source: { file: 'tests/click.e2e.ts', line },
  ...extra,
});
const ran = (status: string, steps: NonNullable<E2EResult['attempts']>[number]['steps'] = []): E2EResult => ({
  id: 'r',
  source: { file: 'tests/click.e2e.ts', line: 83 },
  status,
  attempts: [{ index: 0, status, startedAt: iso(0), durationMs: 10, steps }],
});

describe('drillUnits', () => {
  it('makes tests that share a line one unit, since e2e selects them together by file:line', () => {
    const { units, skipped } = drillUnits([
      pair('should click the aligned 1x1 div', 83),
      pair('should click the aligned 1x1 div', 83),
      pair('should click svg', 120),
      pair('step 1: name the workspace', 200, { serialId: 's' }),
    ]);
    expect(units.map((u) => [u.key, u.title])).toEqual([
      ['tests/click.e2e.ts:83', 'should click the aligned 1x1 div (2 tests on this line)'],
      ['tests/click.e2e.ts:120', 'should click svg'],
    ]);
    expect(skipped).toEqual([{ title: 'step 1: name the workspace', reason: 'serial groups are not supported yet' }]);
  });
});

const act = (mode: string, write: string) => ({ index: 0, kind: 'agent', api: 'agent.act', label: 'open the cart', status: 'passed', cache: { mode, write } });

describe('a unit of several tests', () => {
  it('is recorded only when every test in it passed and recorded its agent steps', () => {
    expect(notRecorded([ran('passed'), ran('failed')])).toBe('failed in the baseline record run, with the recorder on');
    expect(notRecorded([ran('passed', [act('agent-concluded', 'skipped')])])).toContain('was not recorded (cache.write skipped)');
    expect(notRecorded([ran('passed'), ran('passed', [act('agent-concluded', 'saved')])])).toBeUndefined();
  });
  it('is stable only when every test in it replays every agent step', () => {
    expect(replayedSteps([ran('passed', [act('self-finalized', 'kept')]), ran('passed', [act('agent-concluded', 'kept')])])).toEqual({
      reason: 'its agent step "open the cart" did not replay cleanly (agent-concluded)',
    });
    expect(replayedSteps([ran('passed'), ran('failed')])).toEqual({ reason: 'failed when replayed (failed)' });
    expect(replayedSteps([])).toEqual({ reason: 'missing from the replay run' });
    expect(replayedSteps([ran('passed', [act('self-finalized', 'kept')])])).toEqual({
      steps: [{ index: 0, kind: 'agent', api: 'agent.act', label: 'open the cart', cacheMode: 'self-finalized', durationMs: 0 }],
    });
  });
});

describe('drillUnits with several targets', () => {
  it('counts the tests on a line for one target, and lists a left-out test once', () => {
    const { units, skipped } = drillUnits([
      pair('should click svg', 120, { target: 'chromium' }),
      pair('should click svg', 120, { target: 'webkit' }),
      pair('step 1', 200, { serialId: 's', target: 'chromium' }),
      pair('step 1', 200, { serialId: 's', target: 'webkit' }),
    ]);
    expect(units.map((u) => u.title)).toEqual(['should click svg']);
    expect(skipped).toHaveLength(1);
  });
});
