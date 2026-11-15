import { describe, expect, it } from 'vitest';
import { confirmOutcome, scoreTests } from '../src/drill.ts';
import type { MutantRun } from '../src/runner.ts';
import { suggest } from '../src/suggest.ts';
import type { Mutant, MutantVerdict, TestVerdict } from '../src/types.ts';

const passed = (judgment?: string): TestVerdict => ({ test: 't', title: 'cart total adds up', outcome: 'got-through', healed: [], passedJudgments: judgment ? [judgment] : [] });

describe('suggest', () => {
  it('suggests nothing for a caught bug', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-number', title: '', before: '$42.50', after: '$52.50', tests: [] };
    expect(suggest(mutant, 'caught', [])).toEqual([]);
  });
  it('pins the original value on its page, without borrowing an unrelated assert from a test that only passed through', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-number', title: '', before: '$11.25', after: '$21.25', page: '/', tests: [] };
    const [line] = suggest(mutant, 'got-through', [passed('the cart has the book')]);
    expect(line).toBe("Check the exact value on `/`: `await expect(screen.getByText('$11.25')).toBeVisible();`.");
  });
  it('reuses the check of a test that healed past the bug', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-number', title: '', before: '$42.50', after: '$52.50', tests: [] };
    const healed: TestVerdict = { ...passed('the cart total is correct'), outcome: 'healed-past' };
    expect(suggest(mutant, 'healed-past', [healed])[0]).toContain("agent.assert('the cart total is correct, and it shows $42.50')");
  });
  it('for a healed-past dead control, gives the locator click and the route-naming goal', () => {
    const mutant: Mutant = { id: 'm1', type: 'dead-control', title: '', before: 'works', after: '', element: { role: 'button', name: 'Upgrade', region: 'header' }, tests: [] };
    const lines = suggest(mutant, 'healed-past', [passed()]);
    expect(lines[0]).toContain("screen.getByRole('button', { name: 'Upgrade' }).click()");
    expect(lines[1]).toContain('using the "Upgrade" button in the header');
  });
  it('matches a control name with a live count by its stable part', () => {
    const mutant: Mutant = { id: 'm1', type: 'dead-control', title: '', before: 'works', after: '', element: { role: 'link', name: 'Cart (3)', region: 'nav' }, tests: [] };
    const lines = suggest(mutant, 'healed-past', [passed()]);
    expect(lines[0]).toContain("screen.getByRole('link', { name: /^Cart/ }).click()");
    expect(lines[1]).toContain('using the "Cart" link in the nav');
  });
  it('for a hidden test-id element, says toHaveText alone still passes and to check visibility', () => {
    const mutant: Mutant = { id: 'm1', type: 'missing-element', title: '', before: '$12.50', after: '(not shown)', element: { testId: 'order-total' }, tests: [] };
    const [line] = suggest(mutant, 'got-through', [passed()]);
    expect(line).toContain("screen.getByTestId('order-total')).toBeVisible()");
    expect(line).toContain('`toHaveText` still reads the text of a `display: none` element');
  });
  it('for a lost write, says a success message alone cannot tell and to reload and check', () => {
    const mutant: Mutant = { id: 'm1', type: 'lost-write', title: '', before: 'saved', after: '', page: '/account', method: 'PUT', path: '/api/profile', tests: [] };
    const [line] = suggest(mutant, 'got-through', [passed('the profile was saved')]);
    expect(line).toMatch(/Reload and check the stored value.*success message alone can't tell/);
    expect(line).toContain("await app.open('/account');");
  });
  it('for a dropped API item, names the item and the row to check', () => {
    const mutant: Mutant = { id: 'm1', type: 'missing-api-item', title: 'GET /api/cart leaves out "Neuromancer"', before: '', after: '', tests: [] };
    expect(suggest(mutant, 'got-through', [passed()])[0]).toContain("screen.getByRole('row', { name: /Neuromancer/ })");
  });
  it('uses the check from the test that explains the miss, not the first test listed', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-number', title: '', before: '$25.00', after: '$35.00', tests: [] };
    const bystander = { ...passed('the cart has the book'), title: 'add a book' };
    const healed: TestVerdict = { ...passed('the cart total is correct'), outcome: 'healed-past' };
    expect(suggest(mutant, 'healed-past', [bystander, healed])[0]).toContain("agent.assert('the cart total is correct, and it shows $25.00')");
  });
  it('checks a wrong quantity by item, not by a bare digit that also matches prices', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-api-value', title: 'GET /api/cart returns qty 2 for "Dune" instead of 1', before: '1', after: '2', jsonPath: ['items', { id: 'dune' }, 'qty'], tests: [] };
    const lines = suggest(mutant, 'healed-past', [passed()]);
    expect(lines[1]).toContain("agent.assert('the cart has exactly 1 copy of Dune')");
    expect(lines.join(' ')).not.toContain("getByText('1')");
  });
  it('checks the order of swapped table rows with the ordered list form of toContainText', () => {
    const mutant: Mutant = { id: 'm1', type: 'swapped-rows', title: '', before: 'Dune, then Neuromancer', after: '', element: { css: 'body > main:nth-of-type(1) > table:nth-of-type(1) > tbody:nth-of-type(1)' }, tests: [] };
    expect(suggest(mutant, 'got-through', [passed()])[0]).toContain("await expect(screen.getByRole('row')).toContainText(['Dune', 'Neuromancer']);");
  });
  it('checks swapped list items as list items, and a shortened label by its prefix', () => {
    const mutant: Mutant = { id: 'm1', type: 'swapped-rows', title: '', before: 'Ticket A urgent Close A …, then Item 2', after: '', element: { css: 'body > ul:nth-of-type(2)' }, tests: [] };
    expect(suggest(mutant, 'got-through', [passed()])[0]).toContain("await expect(screen.getByRole('listitem')).toContainText(['Ticket A urgent Close A', 'Item 2']);");
  });
  it('for a dead control a test clicked without checking the effect, says so instead of saying no test needs it', () => {
    const mutant: Mutant = { id: 'm1', type: 'dead-control', title: '', before: 'works', after: '', element: { role: 'button', name: 'Hello iframe' }, tests: [] };
    const [line] = suggest(mutant, 'got-through', [passed()]);
    expect(line).toContain('A test clicks "Hello iframe", but nothing checks what the click does.');
  });
  it('checks a missing message by its own role', () => {
    const mutant: Mutant = { id: 'm1', type: 'missing-element', title: '', before: 'Wrong password', after: '(not shown)', page: '/login', element: { css: 'body > p', role: 'alert' }, tests: [] };
    expect(suggest(mutant, 'got-through', [passed()])[0]).toContain("screen.getByRole('alert')).toHaveText('Wrong password')");
  });
  it('formats a wrong API price as money', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-api-value', title: '', before: '12.5', after: '14.5', jsonPath: ['items', { id: 'dune' }, 'price'], tests: [] };
    expect(suggest(mutant, 'got-through', [passed()])[1]).toContain("screen.getByText('$12.50')");
  });
});

const run = (outcome: MutantRun['outcome']): MutantRun => ({ outcome, tests: [], durationMs: 1, costUsd: 0, runDir: outcome });

describe('confirmOutcome', () => {
  it('keeps a miss that misses again, and calls it healed past if either run healed', () => {
    expect(confirmOutcome(run('got-through'), run('got-through')).outcome).toBe('got-through');
    expect(confirmOutcome(run('got-through'), run('healed-past')).outcome).toBe('healed-past');
  });
  it('keeps the run that healed, so the report can show the take-over', () => {
    expect(confirmOutcome(run('got-through'), run('healed-past')).run.runDir).toBe('healed-past');
    expect(confirmOutcome(run('healed-past'), run('got-through')).run.runDir).toBe('healed-past');
  });
  it('marks a miss that the second run caught as flaky', () => {
    expect(confirmOutcome(run('got-through'), run('caught')).outcome).toBe('flaky');
  });
  it('takes the rerun when the first run was only noise', () => {
    expect(confirmOutcome(run('inconclusive'), run('caught'))).toMatchObject({ outcome: 'caught', run: { runDir: 'caught' } });
  });
});

const verdict = (outcome: MutantVerdict['outcome'], testOutcome: TestVerdict['outcome']): MutantVerdict => ({
  mutant: { id: 'm', type: 'wrong-number', title: '', before: '', after: '', tests: ['t'] },
  outcome,
  tests: [{ test: 't', title: 'cart', outcome: testOutcome, healed: [], passedJudgments: [] }],
  durationMs: 0,
  costUsd: 0,
  runDir: '',
  suggestions: [],
});

describe('scoreTests', () => {
  it('counts scored bugs only: a flaky bug says nothing about the test', () => {
    const scores = scoreTests([{ key: 't', title: 'cart' }], [verdict('caught', 'caught'), verdict('got-through', 'got-through'), verdict('flaky', 'got-through')]);
    expect(scores).toEqual([{ key: 't', title: 'cart', caught: 1, missed: 1 }]);
  });
});

describe('suggestions for less common values', () => {
  it('never pins a flag as the text "true"', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-api-value', title: 'GET /api/books returns inStock false for "Dune" instead of true', before: 'true', after: 'false', jsonPath: ['items', { id: 'dune' }, 'inStock'], tests: [] };
    const text = suggest(mutant, 'got-through', [passed()]).join(' ');
    expect(text).not.toContain("getByText('true')");
    expect(text).toContain("screen.getByRole('row', { name: /Dune/ })");
  });
  it('writes a price with thousands separators', () => {
    const mutant: Mutant = { id: 'm1', type: 'wrong-api-value', title: '', before: '1234.5', after: '1244.5', jsonPath: ['items', { id: 'x' }, 'price'], tests: [] };
    expect(suggest(mutant, 'got-through', [passed()])[1]).toContain("screen.getByText('$1,234.50')");
  });
  it('does not open a page path with an :id placeholder', () => {
    const mutant: Mutant = { id: 'm1', type: 'lost-write', title: '', before: 'saved', after: '', page: '/books/:id/edit', method: 'PUT', path: '/api/books/:id', tests: [] };
    const [line] = suggest(mutant, 'got-through', [passed()]);
    expect(line).not.toContain(':id');
    expect(line).toContain('reload the page');
  });
  it('checks swapped rows by their full recorded labels when it has them', () => {
    const mutant: Mutant = { id: 'm1', type: 'swapped-rows', title: '', before: 'A very long first row la…, then Second', after: '', element: { css: 'body > ul' }, rows: ['A very long first row label', 'Second'], tests: [] };
    expect(suggest(mutant, 'got-through', [passed()])[0]).toContain("toContainText(['A very long first row label', 'Second'])");
  });
});
