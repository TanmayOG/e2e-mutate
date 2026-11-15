import { BUG_TYPES, type BugType, type ElementRef, type JsonPathSegment, type JsonValue, type Mutant, type RecorderEvent } from './types.ts';

/** A test's key and what its baseline touched. */
export interface TouchedTest {
  readonly key: string;
  readonly events: readonly RecorderEvent[];
}

type Draft = Omit<Mutant, 'id' | 'tests'>;

/** `$42.50`, `$1,234.56` or `$1234.56`, whole: never the `$123` at the start of `$1234.56`. */
const MONEY = /\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?(?!\d|,\d)/g;
const COUNT = /\b(\d+) (books?|items?)\b/g;
/** Status words a bug can flip. Longer phrases first, so "Out of stock" wins over "stock". */
const WORD_SWAPS: ReadonlyArray<readonly [string, string]> = [
  ['Out of stock', 'In stock'],
  ['In stock', 'Out of stock'],
  ['Confirmed', 'Pending'],
  ['Pending', 'Confirmed'],
  ['Unpaid', 'Paid'],
  ['Paid', 'Unpaid'],
  ['Shipped', 'Processing'],
  ['Processing', 'Shipped'],
  ['Inactive', 'Active'],
  ['Active', 'Inactive'],
  ['Disabled', 'Enabled'],
  ['Enabled', 'Disabled'],
  ['Success', 'Failed'],
  ['Failed', 'Success'],
  ['Free', 'Pro'],
  ['Pro', 'Free'],
];
const PRICE_KEY = /price|amount|cost/i;
const QTY_KEY = /^(?:qty|quantity)$/i;
const FLAG_KEY = /^(?:(?:in|is|has)[A-Z]\w*|available|enabled|active)$/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shorten = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const humanize = (testId: string) => testId.replace(/[-_]+/g, ' ');

/** `$42.50` → `$52.50`: the same format, ten dollars more. */
export function shiftMoney(token: string): string {
  const value = Number(token.replace(/[$,]/g, ''));
  const next = value + 10;
  const decimals = token.includes('.') ? 2 : 0;
  const [whole, fraction] = next.toFixed(decimals).split('.');
  const grouped = token.includes(',') ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole!;
  return `$${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const itemLabel = (item: Record<string, JsonValue>) => String(item.title ?? item.name ?? item.label ?? item.id);

/** Arrays of objects that carry a string `id`, with their path, at the root or up to two keys down. */
function idArrays(body: JsonValue | undefined): Array<{ path: readonly JsonPathSegment[]; items: Array<Record<string, JsonValue>> }> {
  const found: Array<{ path: readonly JsonPathSegment[]; items: Array<Record<string, JsonValue>> }> = [];
  const visit = (value: JsonValue | undefined, path: readonly JsonPathSegment[], depth: number) => {
    if (Array.isArray(value)) {
      const items = value.filter(isRecord).filter((item) => typeof item.id === 'string');
      if (items.length > 0 && items.length === value.length) found.push({ path, items });
      return;
    }
    if (!isRecord(value) || depth > 2) return;
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key], depth + 1);
  };
  visit(body, [], 0);
  return found;
}

/**
 * Controls the tests clicked that a dead-control bug cannot change: every
 * click on them found no click listener on them or above them, no `onclick`
 * and no default action. The bug blocks the click, so there it is an
 * equivalent mutant (it changes nothing a test could see), and none is
 * planted. The drill lists them instead.
 */
export function inertControls(tests: readonly TouchedTest[]): string[] {
  const inert = new Set<string>();
  const live = new Set<string>();
  for (const test of tests) {
    for (const event of test.events) {
      if (event.kind !== 'control' || !event.name) continue;
      const label = `"${shorten(event.name)}" ${event.role} on ${event.page}`;
      (event.inert ? inert : live).add(label);
    }
  }
  return [...inert].filter((label) => !live.has(label)).toSorted();
}

/**
 * Turns what the baseline touched into concrete bugs, one per (type, target),
 * each listing the tests that touched its target. Network bugs that change a
 * value or drop an item keep totals consistent in the page runtime, the way a
 * backend bug would answer: the spike showed a self-contradicting screen gets
 * caught even by a vague check, so those bugs are the less interesting kind.
 */
export function candidateMutants(tests: readonly TouchedTest[]): Array<Draft & { tests: string[] }> {
  const byKey = new Map<string, Draft & { tests: string[] }>();
  const add = (key: string, draft: Draft, test: string) => {
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.tests.includes(test)) existing.tests.push(test);
    } else {
      byKey.set(key, { ...draft, tests: [test] });
    }
  };

  for (const test of tests) {
    for (const event of test.events) {
      switch (event.kind) {
        case 'text': {
          for (const token of event.text.match(MONEY) ?? []) {
            const to = shiftMoney(token);
            add(`wrong-number|${event.page}|${token}`, { type: 'wrong-number', title: `Shows ${to} where it showed ${token} on ${event.page}`, before: token, after: to, page: event.page, from: token, to }, test.key);
          }
          for (const match of event.text.matchAll(COUNT)) {
            const to = `${Number(match[1]) + 1} ${match[2]}`;
            add(`wrong-number|${event.page}|${match[0]}`, { type: 'wrong-number', title: `Says "${to}" where it said "${match[0]}" on ${event.page}`, before: match[0], after: to, page: event.page, from: match[0], to }, test.key);
          }
          for (const [from, to] of WORD_SWAPS) {
            if (!new RegExp(`(?<![\\w])${escape(from)}(?![\\w])`).test(event.text)) continue;
            add(`wrong-word|${event.page}|${from}`, { type: 'wrong-word', title: `Says "${to}" where it said "${from}" on ${event.page}`, before: from, after: to, page: event.page, from, to }, test.key);
            break;
          }
          break;
        }
        case 'element': {
          const element: ElementRef = event.testId !== undefined ? { testId: event.testId, text: event.text } : { css: event.css, ...(event.role !== undefined ? { role: event.role } : {}), text: event.text };
          const what = event.testId !== undefined ? `The ${humanize(event.testId)}` : `The status message`;
          add(`missing-element|${event.page}|${event.testId ?? event.css}`, { type: 'missing-element', title: `${what} is missing on ${event.page}`, before: shorten(event.text), after: '(not shown)', page: event.page, element }, test.key);
          break;
        }
        case 'control': {
          if (!event.name || event.inert) break;
          const element: ElementRef = { role: event.role, name: event.name, ...(event.region !== undefined ? { region: event.region } : {}) };
          const where = event.region === 'header' || event.region === 'nav' ? ` in the ${event.region}` : '';
          add(`dead-control|${event.page}|${event.role}|${event.name}|${event.region ?? ''}`, { type: 'dead-control', title: `The "${shorten(event.name)}" ${event.role}${where} does nothing on ${event.page}`, before: 'works', after: 'does nothing when clicked', page: event.page, element }, test.key);
          break;
        }
        case 'list': {
          const [first, second] = event.rows;
          if (first === undefined || second === undefined || first === second) break;
          add(`swapped-rows|${event.page}|${event.css}`, { type: 'swapped-rows', title: `The first two rows swap places ("${shorten(first, 24)}" and "${shorten(second, 24)}") on ${event.page}`, before: `${shorten(first, 24)}, then ${shorten(second, 24)}`, after: `${shorten(second, 24)}, then ${shorten(first, 24)}`, page: event.page, element: { css: event.css }, rows: [first, second] }, test.key);
          break;
        }
        case 'request': {
          if (!event.sameOrigin) break;
          const request = `${event.method} ${event.path}`;
          if (event.method !== 'GET') {
            add(`server-error|${request}`, { type: 'server-error', title: `${request} answers 500`, before: String(event.status), after: '500', page: event.page, method: event.method, path: event.path }, test.key);
            if (WRITE_METHODS.has(event.method) && isRecord(event.requestJson)) {
              add(`lost-write|${request}`, { type: 'lost-write', title: `${request} says it worked but saves nothing`, before: 'saved', after: 'answers OK, saves nothing', page: event.page, method: event.method, path: event.path }, test.key);
            }
            break;
          }
          for (const array of idArrays(event.responseJson)) {
            const first = array.items[0]!;
            for (const [key, value] of Object.entries(first)) {
              let next: JsonValue | undefined;
              if (typeof value === 'number' && PRICE_KEY.test(key)) next = Math.round((value + 2) * 100) / 100;
              else if (typeof value === 'number' && QTY_KEY.test(key)) next = value + 1;
              else if (typeof value === 'boolean' && FLAG_KEY.test(key)) next = !value;
              if (next === undefined) continue;
              const id = String(first.id);
              add(`wrong-api-value|${request}|${array.path.join('.')}|${id}|${key}`, { type: 'wrong-api-value', title: `${request} returns ${key} ${String(next)} for "${itemLabel(first)}" instead of ${String(value)}`, before: String(value), after: String(next), method: event.method, path: event.path, jsonPath: [...array.path, { id }, key], value: next }, test.key);
            }
            if (array.items.length >= 2) {
              const last = array.items[array.items.length - 1]!;
              const id = String(last.id);
              add(`missing-api-item|${request}|${array.path.join('.')}|${id}`, { type: 'missing-api-item', title: `${request} leaves out "${itemLabel(last)}"`, before: `${array.items.length} items`, after: `${array.items.length - 1} items, totals still add up`, method: event.method, path: event.path, jsonPath: array.path, itemId: id }, test.key);
            }
          }
          break;
        }
      }
    }
  }
  return [...byKey.values()];
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/**
 * Picks at most `max` mutants, round-robin across bug types so each type is
 * represented. Within a type it picks the bug that reaches the least-drilled
 * test so far, so every test gets bugs aimed at what it touches, not only the
 * pages every test passes through; ties go to the bug more tests touch, then
 * the title. Ids are stable for the same baseline: `m01-<type>-<target>`.
 */
export function selectMutants(
  candidates: ReadonlyArray<Draft & { tests: string[] }>,
  options: { readonly max: number; readonly types?: readonly BugType[]; readonly ignore?: ReadonlySet<string> },
): Mutant[] {
  const types = options.types ?? BUG_TYPES;
  const queues = types.map((type) =>
    candidates.filter((candidate) => candidate.type === type && !options.ignore?.has(candidate.title)),
  );
  const drilled = new Map<string, number>();
  const leastDrilled = (draft: Draft & { tests: string[] }) => Math.min(...draft.tests.map((test) => drilled.get(test) ?? 0));
  const picked: Array<Draft & { tests: string[] }> = [];
  while (picked.length < options.max && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (queue.length === 0 || picked.length >= options.max) continue;
      const best = queue.reduce((a, b) => {
        const byCoverage = leastDrilled(a) - leastDrilled(b);
        if (byCoverage !== 0) return byCoverage < 0 ? a : b;
        if (a.tests.length !== b.tests.length) return a.tests.length > b.tests.length ? a : b;
        return a.title.localeCompare(b.title) <= 0 ? a : b;
      });
      queue.splice(queue.indexOf(best), 1);
      picked.push(best);
      for (const test of best.tests) drilled.set(test, (drilled.get(test) ?? 0) + 1);
    }
  }
  return picked.map((draft, index) => {
    const target = draft.element?.name ?? draft.element?.testId ?? draft.from ?? draft.itemId ?? draft.path ?? draft.page ?? '';
    return { ...draft, id: `m${String(index + 1).padStart(2, '0')}-${draft.type}-${slug(target)}`.replace(/-$/, ''), tests: draft.tests.toSorted() };
  });
}
