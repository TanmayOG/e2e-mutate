import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const runtime = readFileSync(path.join(import.meta.dirname, '../in-page/apply.js'), 'utf8');

/** A page at `url` with one bug planted, as its init script plants it. Returns the page and the bug's "applied" lines. */
function planted(url: string, html: string, spec: Record<string, unknown>) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only', url });
  const { window } = dom;
  const applied: string[] = [];
  Object.assign(window.console, { info: (line: string) => applied.push(line) });
  // jsdom has no CSS.escape; the runtime only needs it for test ids.
  Object.assign(window, { CSS: { escape: (text: string) => text } });
  window.eval(`${runtime}\n__e2eMutateApply(${JSON.stringify(spec)});`);
  return { window, document: window.document, applied };
}
/** MutationObserver callbacks run as microtasks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const texts = (list: Element) => [...list.children].map((row) => row.textContent);

describe('swapped rows', () => {
  const spec = { id: 'm1', type: 'swapped-rows', page: '/list', element: { css: 'body > ul:nth-of-type(1)' }, rows: ['A', 'B'] };

  it('stays swapped when another row changes, instead of swapping back', async () => {
    const { document, applied } = planted('http://127.0.0.1/list', '<ul><li>A</li><li>B</li><li>C</li></ul>', spec);
    const list = document.querySelector('ul')!;
    expect(texts(list)).toEqual(['B', 'A', 'C']);

    list.children[2]!.textContent = 'C2';
    await settle();
    expect(texts(list)).toEqual(['B', 'A', 'C2']);
    expect(applied).toHaveLength(1);
  });

  it('swaps whatever rows the list holds: another test fills it with other data', () => {
    const { document } = planted('http://127.0.0.1/list', '<ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>', spec);
    expect(texts(document.querySelector('ul')!)).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('swaps again when the app renders the rows back in their recorded order', async () => {
    const { document } = planted('http://127.0.0.1/list', '<ul><li>A</li><li>B</li><li>C</li></ul>', spec);
    const list = document.querySelector('ul')!;
    list.innerHTML = '<li>A</li><li>B</li><li>C</li>';
    await settle();
    expect(texts(list)).toEqual(['B', 'A', 'C']);
  });
});

describe('a single-page app', () => {
  const spec = { id: 'm2', type: 'missing-element', page: '/cart', element: { testId: 'total' } };

  it('gets the bug when it reaches the page without a reload', async () => {
    const { window, document, applied } = planted('http://127.0.0.1/', '<main></main>', spec);
    window.history.pushState({}, '', '/cart');
    document.querySelector('main')!.innerHTML = '<p data-testid="total">$42.50</p>';
    await settle();
    expect(document.querySelector<HTMLElement>('[data-testid="total"]')!.style.display).toBe('none');
    expect(applied).toEqual(['[e2e-mutate] applied m2']);
  });

  it('stops changing pages once it leaves the target page', async () => {
    const { window, document } = planted('http://127.0.0.1/cart', '<main><p data-testid="total">$42.50</p></main>', spec);
    expect(document.querySelector<HTMLElement>('[data-testid="total"]')!.style.display).toBe('none');
    window.history.pushState({}, '', '/');
    document.querySelector('main')!.innerHTML = '<p data-testid="total">$9.00</p>';
    await settle();
    expect(document.querySelector<HTMLElement>('[data-testid="total"]')!.style.display).toBe('');
  });
});
