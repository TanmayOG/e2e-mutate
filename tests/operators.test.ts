import { describe, expect, it } from 'vitest';
import { candidateMutants, inertControls, selectMutants, shiftMoney, type TouchedTest } from '../src/operators.ts';
import type { RecorderEvent } from '../src/types.ts';

const at = 1;
const cart = { items: [{ id: 'dune', title: 'Dune', price: 12.5, qty: 2 }, { id: 'neuromancer', title: 'Neuromancer', price: 17.5, qty: 1 }], total: 42.5, count: 3 };
const cartTest: TouchedTest = {
  key: 'tests/cart.e2e.ts:3',
  events: [
    { kind: 'text', at, page: '/cart', text: '$42.50' },
    { kind: 'text', at, page: '/account', text: 'Free' },
    { kind: 'text', at, page: '/', text: 'Out of stock' },
    { kind: 'element', at, page: '/cart', testId: 'cart-total', text: '$42.50', css: 'body > main' },
    { kind: 'list', at, page: '/cart', css: 'body > tbody', rows: ['Dune', 'Neuromancer'] },
    { kind: 'control', at, page: '/account', role: 'button', name: 'Upgrade', region: 'header' },
    { kind: 'request', at, page: '/cart', method: 'GET', path: '/api/cart', sameOrigin: true, status: 200, responseJson: cart },
    { kind: 'request', at, page: '/account', method: 'PUT', path: '/api/profile', sameOrigin: true, status: 200, requestJson: { name: 'Ada' } },
    { kind: 'request', at, page: '/', method: 'POST', path: '/collect', sameOrigin: false, status: 204 },
  ] satisfies RecorderEvent[],
};

describe('shiftMoney', () => {
  it('adds ten dollars in the same format', () => {
    expect(shiftMoney('$42.50')).toBe('$52.50');
    expect(shiftMoney('$11.25')).toBe('$21.25');
    expect(shiftMoney('$1,995.00')).toBe('$2,005.00');
    expect(shiftMoney('$7')).toBe('$17');
  });
});

describe('candidateMutants', () => {
  const candidates = candidateMutants([cartTest]);
  const ofType = (type: string) => candidates.filter((c) => c.type === type);

  it('plants a wrong number for each money value it saw', () => {
    expect(ofType('wrong-number')).toEqual([expect.objectContaining({ page: '/cart', from: '$42.50', to: '$52.50' })]);
  });
  it('flips status words, longest phrase first', () => {
    expect(ofType('wrong-word').map((c) => [c.from, c.to])).toEqual([
      ['Free', 'Pro'],
      ['Out of stock', 'In stock'],
    ]);
  });
  it('hides elements by test id, swaps list rows, and kills clicked controls with their region', () => {
    expect(ofType('missing-element')[0]?.element).toEqual({ testId: 'cart-total', text: '$42.50' });
    expect(ofType('swapped-rows')[0]).toMatchObject({ element: { css: 'body > tbody' }, before: 'Dune, then Neuromancer' });
    expect(ofType('dead-control')[0]).toMatchObject({ element: { role: 'button', name: 'Upgrade', region: 'header' }, title: 'The "Upgrade" button in the header does nothing on /account' });
  });
  it('plants server errors and lost writes on same-origin writes only', () => {
    expect(ofType('server-error').map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /api/profile']);
    expect(ofType('lost-write').map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /api/profile']);
  });
  it('changes a price or quantity of an item picked by id, and drops the last item', () => {
    expect(ofType('wrong-api-value').map((c) => [c.jsonPath, c.value])).toEqual([
      [['items', { id: 'dune' }, 'price'], 14.5],
      [['items', { id: 'dune' }, 'qty'], 3],
    ]);
    expect(ofType('missing-api-item')[0]).toMatchObject({ jsonPath: ['items'], itemId: 'neuromancer', title: 'GET /api/cart leaves out "Neuromancer"' });
  });
  it('merges the same target across tests into one mutant listing both tests', () => {
    const other: TouchedTest = { key: 'tests/other.e2e.ts:9', events: [{ kind: 'text', at, page: '/cart', text: '$42.50' }] };
    const merged = candidateMutants([cartTest, other]).filter((c) => c.type === 'wrong-number');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.tests).toEqual([cartTest.key, other.key]);
  });
});

describe('selectMutants', () => {
  it('caps the count, round-robins across types, and gives stable ids', () => {
    const picked = selectMutants(candidateMutants([cartTest]), { max: 4 });
    expect(picked.map((m) => m.type)).toEqual(['wrong-number', 'wrong-word', 'missing-element', 'dead-control']);
    expect(picked[0]?.id).toBe('m01-wrong-number-42-50');
    expect(picked[3]?.id).toBe('m04-dead-control-upgrade');
  });
  it('prefers a bug that reaches a test no bug reached yet, over title order', () => {
    // After "Add" (tests a and b), "Apply" would win on title, but only reaches b again; "Zoom" reaches c.
    const a: TouchedTest = { key: 'a', events: [{ kind: 'control', at, page: '/', role: 'button', name: 'Add', region: 'main' }] };
    const b: TouchedTest = { key: 'b', events: [{ kind: 'control', at, page: '/', role: 'button', name: 'Add', region: 'main' }, { kind: 'control', at, page: '/x', role: 'button', name: 'Apply', region: 'main' }] };
    const c: TouchedTest = { key: 'c', events: [{ kind: 'control', at, page: '/y', role: 'button', name: 'Zoom', region: 'main' }] };
    const picked = selectMutants(candidateMutants([a, b, c]), { max: 2, types: ['dead-control'] });
    expect(picked.map((m) => m.element?.name)).toEqual(['Add', 'Zoom']);
  });
  it('skips ignored titles and unselected types', () => {
    const candidates = candidateMutants([cartTest]);
    const picked = selectMutants(candidates, { max: 50, types: ['wrong-word'], ignore: new Set(['Says "Pro" where it said "Free" on /account']) });
    expect(picked.map((m) => m.from)).toEqual(['Out of stock']);
  });
});

const click = (name: string, inert?: boolean): RecorderEvent => ({ kind: 'control', at, page: '/content', role: 'button', name, ...(inert ? { inert } : {}) });

describe('inert controls', () => {
  it('plants no dead-control bug on a control nothing listens to', () => {
    const candidates = candidateMutants([{ key: 'a', events: [click('Hello iframe', true), click('Save')] }]);
    expect(candidates.filter((c) => c.type === 'dead-control').map((c) => c.element?.name)).toEqual(['Save']);
  });
  it('plants it for the tests where the control was live, and lists only controls inert everywhere', () => {
    const tests: TouchedTest[] = [
      { key: 'a', events: [click('Save', true), click('0', true)] },
      { key: 'b', events: [click('Save')] },
    ];
    expect(candidateMutants(tests).find((c) => c.type === 'dead-control')?.tests).toEqual(['b']);
    expect(inertControls(tests)).toEqual(['"0" button on /content']);
  });
});

describe('money values', () => {
  it('reads a price over $999 whole, with or without a thousands comma', () => {
    const touched: TouchedTest = { key: 'a', events: [{ kind: 'text', at, page: '/', text: 'Total $1234.56, was $1,234.56' }] };
    const titles = candidateMutants([touched]).filter((c) => c.type === 'wrong-number').map((c) => [c.from, c.to]);
    expect(titles).toEqual([
      ['$1234.56', '$1244.56'],
      ['$1,234.56', '$1,244.56'],
    ]);
  });
});

describe('swapped rows', () => {
  it('carries the first two rows in their recorded order, for the page runtime to keep swapped', () => {
    const swap = candidateMutants([cartTest]).find((c) => c.type === 'swapped-rows');
    expect(swap?.rows).toEqual(['Dune', 'Neuromancer']);
  });
});
