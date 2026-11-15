/*
 * e2e-mutate mutant runtime. Injected as an e2e init script, with one mutant
 * spec, for one run. It plants that one bug in the running page, without
 * touching the app's source, and logs `[e2e-mutate] applied <id>` through
 * `console.info` each time the bug actually changes something. e2e keeps that
 * line in the attempt's `appLog`, with the step it happened in.
 *
 * Network bugs patch `window.fetch` only; `XMLHttpRequest` is not covered.
 */
// oxlint-disable-next-line no-unused-vars
function __e2eMutateApply(SPEC) {
  if (window.__e2eMutateApplied) return;
  window.__e2eMutateApplied = true;

  const CONTROL = 'button, a[href], [role="button"], [role="link"], input[type="submit"], input[type="button"]';
  const normalizePath = (pathname) =>
    pathname
      .split('/')
      .map((part) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) || /^\d+$/.test(part) ? ':id' : part))
      .join('/');
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const onPage = () => SPEC.page === undefined || normalizePath(location.pathname) === SPEC.page;

  let lastReport = 0;
  const report = (force) => {
    const now = Date.now();
    if (!force && now - lastReport < 400) return;
    lastReport = now;
    console.info('[e2e-mutate] applied ' + SPEC.id);
  };

  const whenBody = (fn) => {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };
  const observe = (fn) =>
    whenBody(() => {
      fn();
      new MutationObserver(fn).observe(document.body, { subtree: true, childList: true, characterData: true });
    });

  // --- screen bugs -----------------------------------------------------------

  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Screen bugs check the page on every change, not once at load: a
  // single-page app reaches the page without reloading, and leaves it the same way.
  function swapText() {
    const pattern = new RegExp('(?<![\\w])' + escape(SPEC.from) + '(?![\\w])', 'g');
    observe(() => {
      if (!onPage()) return;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let changed = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue || !node.nodeValue.includes(SPEC.from)) continue;
        if (node.parentElement && node.parentElement.closest('script, style')) continue;
        const next = node.nodeValue.replace(pattern, SPEC.to);
        if (next !== node.nodeValue) {
          node.nodeValue = next;
          changed = true;
        }
      }
      if (changed) report();
    });
  }

  const matchesElement = (element) => {
    const ref = SPEC.element;
    if (ref.testId !== undefined) return element.getAttribute('data-testid') === ref.testId;
    return element.matches(ref.css);
  };
  function hideElement() {
    const ref = SPEC.element;
    const selector = ref.testId !== undefined ? '[data-testid="' + CSS.escape(ref.testId) + '"]' : ref.css;
    observe(() => {
      if (!onPage()) return;
      for (const element of document.querySelectorAll(selector)) {
        if (!matchesElement(element) || element.dataset.e2eMutateHidden === '1') continue;
        if (!clean(element.textContent)) continue;
        element.dataset.e2eMutateHidden = '1';
        element.style.setProperty('display', 'none', 'important');
        element.setAttribute('aria-hidden', 'true');
        report(true);
      }
    });
  }

  function deadControl() {
    const ref = SPEC.element;
    const block = (event) => {
      if (!onPage()) return;
      const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
      if (!control) return;
      const role = control.getAttribute('role') || (control.tagName === 'A' ? 'link' : 'button');
      const name = clean(control.getAttribute('aria-label') || control.textContent || control.getAttribute('value') || '');
      if (role !== ref.role || name !== ref.name) return;
      if (ref.region !== undefined) {
        const region = control.closest('header, nav, main, footer, aside');
        if (!region || region.tagName.toLowerCase() !== ref.region) return;
      }
      event.stopImmediatePropagation();
      event.preventDefault();
      report(true);
    };
    window.addEventListener('click', block, true);
  }

  // The rows the bug moved to the top. A list whose first row is one of them is
  // already swapped, so a change elsewhere in it doesn't swap it back; a
  // re-render brings other rows to the top, and those are swapped again. The
  // rows themselves can differ from test to test: it is the list that is broken.
  const movedFirst = new WeakSet();
  function swapRows() {
    observe(() => {
      if (!onPage()) return;
      for (const list of document.querySelectorAll(SPEC.element.css)) {
        const [first, second] = list.children;
        if (!first || !second || movedFirst.has(first)) continue;
        list.insertBefore(second, first);
        movedFirst.add(second);
        report(true);
      }
    });
  }

  // --- network bugs ----------------------------------------------------------

  const round = (n) => Math.round(n * 100) / 100;
  /** Keeps totals and counts consistent with an `items` array, the way a backend bug would answer. */
  const recomputeTotals = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 3) return;
    if (Array.isArray(value)) {
      for (const item of value) recomputeTotals(item, depth + 1);
      return;
    }
    const items = Array.isArray(value.items) ? value.items : undefined;
    if (items && items.every((item) => item && typeof item.price === 'number')) {
      const qty = (item) => (typeof item.qty === 'number' ? item.qty : typeof item.quantity === 'number' ? item.quantity : 1);
      if (typeof value.total === 'number') value.total = round(items.reduce((sum, item) => sum + item.price * qty(item), 0));
      if (typeof value.subtotal === 'number') value.subtotal = round(items.reduce((sum, item) => sum + item.price * qty(item), 0));
      if (typeof value.count === 'number') value.count = items.reduce((sum, item) => sum + qty(item), 0);
    }
    for (const key of Object.keys(value)) recomputeTotals(value[key], depth + 1);
  };
  /** Walks a path of keys, indexes, and `{ id }` matchers for array items; returns the parent and key of the leaf. */
  const resolve = (root, path) => {
    let parent;
    let key;
    let node = root;
    for (const segment of path) {
      if (node === null || typeof node !== 'object') return undefined;
      parent = node;
      if (segment !== null && typeof segment === 'object') {
        if (!Array.isArray(node)) return undefined;
        key = node.findIndex((item) => item && item.id === segment.id);
        if (key < 0) return undefined;
      } else {
        key = segment;
      }
      node = node[key];
    }
    return parent === undefined ? undefined : { parent, key };
  };

  const originalFetch = window.fetch;
  const requestInfo = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return { url, method, path: normalizePath(url.pathname) };
  };
  const jsonResponse = (body, status, statusText) =>
    new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } });
  const matchesRequest = (info) => info.method === SPEC.method && info.path === SPEC.path && info.url.origin === location.origin;

  function patchFetch(handler) {
    window.fetch = function (input, init) {
      const info = requestInfo(input, init);
      if (!matchesRequest(info)) return originalFetch.apply(this, arguments);
      return handler.call(this, input, init, arguments);
    };
  }

  function serverError() {
    patchFetch(() => {
      report(true);
      return Promise.resolve(jsonResponse({ error: 'Internal Server Error' }, 500, 'Internal Server Error'));
    });
  }

  function lostWrite() {
    patchFetch((input, init) => {
      report(true);
      let echo = {};
      try {
        echo = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      } catch {}
      return Promise.resolve(jsonResponse(echo, 200, 'OK'));
    });
  }

  function changeResponse(change) {
    patchFetch(async function (input, init, args) {
      const response = await originalFetch.apply(this, args);
      if (!response.ok) return response;
      let body;
      try {
        body = await response.clone().json();
      } catch {
        return response;
      }
      if (!change(body)) return response;
      recomputeTotals(body);
      report(true);
      return jsonResponse(body, response.status, response.statusText);
    });
  }

  function wrongApiValue() {
    changeResponse((body) => {
      const leaf = resolve(body, SPEC.jsonPath);
      if (!leaf || leaf.parent[leaf.key] === SPEC.value) return false;
      leaf.parent[leaf.key] = SPEC.value;
      return true;
    });
  }

  function missingApiItem() {
    changeResponse((body) => {
      let array = body;
      if (SPEC.jsonPath.length > 0) {
        const leaf = resolve(body, SPEC.jsonPath);
        array = leaf ? leaf.parent[leaf.key] : undefined;
      }
      if (!Array.isArray(array) || array.length < 2) return false;
      const index = array.findIndex((item) => item && item.id === SPEC.itemId);
      if (index < 0) return false;
      array.splice(index, 1);
      return true;
    });
  }

  const handlers = {
    'wrong-number': swapText,
    'wrong-word': swapText,
    'missing-element': hideElement,
    'dead-control': deadControl,
    'swapped-rows': swapRows,
    'server-error': serverError,
    'lost-write': lostWrite,
    'wrong-api-value': wrongApiValue,
    'missing-api-item': missingApiItem,
  };
  const handler = handlers[SPEC.type];
  if (handler) handler();
}
