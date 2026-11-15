import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(import.meta.dirname, '../in-page/recorder.js'), 'utf8').replaceAll('__ENDPOINT__', JSON.stringify('http://127.0.0.1:9/collect'));

/** A page with the recorder injected first, as an init script is, before any page script adds a listener. */
function page(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only', url: 'http://127.0.0.1:4000/' });
  const { window } = dom;
  const sent: Array<Record<string, unknown>> = [];
  Object.assign(window, { fetch: () => Promise.reject(new Error('no network in tests')) });
  Object.defineProperty(window.navigator, 'sendBeacon', {
    value: (_url: string, body: string) => {
      sent.push(...(JSON.parse(body) as Array<Record<string, unknown>>));
      return true;
    },
  });
  window.eval(source);
  const $ = (selector: string) => window.document.querySelector<HTMLElement>(selector)!;
  /** Clicks each element and returns the recorder's `inert` flag for it, by control name. */
  const clickAll = async (...selectors: string[]) => {
    sent.length = 0;
    for (const selector of selectors) $(selector).click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Object.fromEntries(sent.filter((event) => event.kind === 'control').map((event) => [event.name, event.inert === true]));
  };
  return { window, $, clickAll, sent };
}

describe('the recorder marks controls that nothing listens to', () => {
  it('a button with no click listener, no onclick and no default action is inert; any of those makes it live', async () => {
    const { $, clickAll } = page(`
      <button id="plain">Plain</button>
      <button id="listener">Listener</button>
      <button id="handler">Handler</button>
      <section id="root"><div><button id="delegated">Delegated</button></div></section>
      <form><button id="submit">Submit</button><button id="typed" type="button">Typed</button><input id="send" type="submit" value="Send"></form>
      <input id="loose" type="submit" value="Loose">
      <a id="link" href="#x">Link</a>
      <button id="keys">Keys</button>
      <button id="press">Press</button>
    `);
    $('#listener').addEventListener('click', () => {});
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the case under test: an `onclick` handler, not a listener
    $('#handler').onclick = () => {};
    $('#root').addEventListener('click', () => {});
    $('#keys').addEventListener('keydown', () => {});
    // The bug blocks only the click event, so a pointerdown handler still runs with it in place.
    $('#press').addEventListener('pointerdown', () => {});

    expect(await clickAll('#plain', '#listener', '#handler', '#delegated', '#submit', '#typed', '#send', '#loose', '#link', '#keys', '#press')).toEqual({
      Plain: true,
      Listener: false,
      Handler: false,
      Delegated: false,
      Submit: false,
      Typed: true,
      Send: false,
      Loose: true,
      Link: false,
      Keys: true,
      Press: true,
    });
  });

  it('a click listener on the window or the document makes every control live', async () => {
    const onWindow = page('<button id="b">On window</button>');
    onWindow.window.addEventListener('click', () => {});
    expect(await onWindow.clickAll('#b')).toEqual({ 'On window': false });

    const onDocument = page('<button id="b">On document</button>');
    onDocument.window.document.addEventListener('click', () => {});
    expect(await onDocument.clickAll('#b')).toEqual({ 'On document': false });
  });

  it("does not count the listeners Playwright's injected script adds for its hit-target check", async () => {
    const { window, clickAll } = page('<button id="b">Hello iframe</button>');
    // The shape of Playwright's injected script: `new InjectedScript()` calls `_setupHitTargetInterceptors`.
    window.eval('class InjectedScript { constructor() { for (const t of ["pointerdown", "click"]) window.addEventListener(t, () => {}, true); } }; new InjectedScript();');
    expect(await clickAll('#b')).toEqual({ 'Hello iframe': true });
  });

  it("does not count the recorder's own click listener", async () => {
    const { clickAll } = page('<button id="b">Alone</button>');
    expect(await clickAll('#b')).toEqual({ Alone: true });
  });
});

describe('the recorder sends a click at once', () => {
  it('a test that ends right after its last tap still has that tap recorded', () => {
    const { $, sent } = page('<button id="b">Last</button>');
    $('#b').click();
    // No waiting: e2e can close the page before the next task runs.
    expect(sent.some((event) => event.kind === 'control' && event.name === 'Last')).toBe(true);
  });
});
