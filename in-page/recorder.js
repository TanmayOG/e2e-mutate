/*
 * e2e-mutate baseline recorder. Injected as an e2e init script during the
 * baseline run only. It observes, never changes the app: the visible text that
 * holds money, counts or status words; elements with a test id or a status
 * role; lists with two or more rows; the controls a test clicks, and whether
 * anything listens for their clicks; and every `fetch` the page makes, with
 * its JSON. It sends batches to the e2e-mutate
 * collector on 127.0.0.1; the tool fills in its address when it writes the script.
 */
(() => {
  if (window.__e2eMutateRecorder) return;
  window.__e2eMutateRecorder = true;

  const ENDPOINT = __ENDPOINT__;
  const MONEY = /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
  const COUNT = /\b\d+ (?:books?|items?)\b/;
  const WORDS = /\b(?:Free|Pro|In stock|Out of stock|Confirmed|Pending|Paid|Unpaid|Shipped|Processing|Active|Inactive|Enabled|Disabled|Success|Failed)\b/;
  const CONTROL = 'button, a[href], [role="button"], [role="link"], input[type="submit"], input[type="button"]';
  const originalFetch = window.fetch.bind(window);

  // Which targets have a click listener. Init scripts run before the page's
  // own scripts, so every listener the page adds passes through here. The
  // dead-control bug blocks the click event (in-page/apply.js), so a control
  // with no click listener on it or above it, no onclick handler and no
  // default action works the same with or without the bug: no test could see
  // it, so that bug is not planted.
  const listening = new WeakSet();
  // Playwright's injected script adds click listeners on the window for its
  // own hit-target check (`InjectedScript._setupHitTargetInterceptors`). They
  // belong to the test tool, not the app. If that name ever changes, controls
  // just count as live, as they would without this check.
  const fromTestTool = () => /\bInjectedScript\b/.test(String(new Error().stack));
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (listener && type === 'click' && !fromTestTool()) listening.add(this);
    return originalAddEventListener.call(this, type, listener, options);
  };

  const normalizePath = (pathname) =>
    pathname
      .split('/')
      .map((part) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) || /^\d+$/.test(part) ? ':id' : part))
      .join('/');
  const page = () => normalizePath(location.pathname);
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

  const queue = [];
  const seen = new Set();
  let timer;
  const push = (event, key) => {
    if (key !== undefined) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    queue.push({ ...event, at: Date.now(), page: page() });
    // Send at the end of this task, not later: e2e closes the page without a
    // pagehide event, so anything still queued when a fast test ends is lost.
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, 0);
    }
  };
  const send = (body) => {
    try {
      if (navigator.sendBeacon(ENDPOINT, body)) return;
    } catch {}
    originalFetch(ENDPOINT, { method: 'POST', body, keepalive: true, mode: 'no-cors' }).catch(() => {});
  };
  const flush = () => {
    if (queue.length === 0) return;
    let batch = [];
    let size = 2;
    for (const event of queue.splice(0)) {
      const text = JSON.stringify(event);
      if (size + text.length > 50000 && batch.length > 0) {
        send('[' + batch.join(',') + ']');
        batch = [];
        size = 2;
      }
      batch.push(text);
      size += text.length + 1;
    }
    if (batch.length > 0) send('[' + batch.join(',') + ']');
  };

  const cssPath = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.tagName === node.tagName) index += 1;
      }
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
    }
    return 'body > ' + parts.join(' > ');
  };
  const visible = (element) => {
    if (!element) return false;
    if (typeof element.checkVisibility === 'function') return element.checkVisibility();
    return element.getClientRects().length > 0;
  };
  const controlRole = (element) => {
    const role = element.getAttribute('role');
    if (role) return role;
    return element.tagName === 'A' ? 'link' : 'button';
  };
  const controlName = (element) =>
    clean(element.getAttribute('aria-label') || element.textContent || element.getAttribute('value') || '');
  const hasDefaultAction = (control) => {
    if (control.matches('a[href], area[href], label, summary, select, textarea, [popovertarget], [commandfor]')) return true;
    if (control.tagName === 'INPUT' && !['button', 'submit', 'reset', 'image'].includes(control.type)) return true;
    // A submit or reset button, or input, acts on its form; with no form, it does nothing.
    return (control.tagName === 'BUTTON' || control.tagName === 'INPUT') && control.type !== 'button' && Boolean(control.form);
  };
  const hasInline = (target) => typeof target.onclick === 'function';
  const hasClickBehavior = (control) => {
    if (hasDefaultAction(control)) return true;
    for (let node = control; node; node = node.parentNode ?? node.host) {
      if (listening.has(node) || hasInline(node)) return true;
    }
    return listening.has(window) || hasInline(window);
  };

  const scan = () => {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript')) continue;
      const text = clean(node.nodeValue);
      if (!text || text.length > 160) continue;
      if (!MONEY.test(text) && !COUNT.test(text) && !WORDS.test(text)) continue;
      if (!visible(parent)) continue;
      push({ kind: 'text', text }, 'text|' + page() + '|' + text);
    }
    for (const element of document.querySelectorAll('[data-testid], [role="status"]')) {
      const text = clean(element.textContent);
      // Skip loading placeholders such as "…": the element is recorded once, with its real text.
      if (!/[\p{L}\p{N}]/u.test(text) || !visible(element)) continue;
      const testId = element.getAttribute('data-testid') || undefined;
      const css = cssPath(element);
      push(
        { kind: 'element', testId, role: element.getAttribute('role') || undefined, text, css },
        'element|' + page() + '|' + (testId ?? css),
      );
    }
    for (const list of document.querySelectorAll('tbody, ul, ol')) {
      // A table row is named by its first cell ("Dune"), not all its cells run together.
      const label = (row) => clean((row.querySelector(':scope > td, :scope > th') ?? row).textContent).slice(0, 80);
      const rows = [...list.children].filter(visible).map(label);
      if (rows.length < 2) continue;
      push({ kind: 'list', css: cssPath(list), rows: rows.slice(0, 6) }, 'list|' + page() + '|' + cssPath(list) + '|' + rows.join('|'));
    }
  };
  // Scan on the first change right away, then at most every 30 ms: a fast test
  // can check the screen and end within a few dozen milliseconds of it rendering.
  let scanTimer;
  let lastScan = 0;
  const scheduleScan = () => {
    if (Date.now() - lastScan >= 30) {
      lastScan = Date.now();
      scan();
      return;
    }
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      lastScan = Date.now();
      scan();
    }, 30);
  };

  // Registered past the wrapper above: the recorder's own listener must not make every control look live.
  originalAddEventListener.call(
    window,
    'click',
    (event) => {
      const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
      if (!control) return;
      const region = control.closest('header, nav, main, footer, aside');
      const inert = !hasClickBehavior(control) || undefined;
      push(
        { kind: 'control', role: controlRole(control), name: controlName(control), region: region ? region.tagName.toLowerCase() : undefined, inert },
        'control|' + page() + '|' + controlRole(control) + '|' + controlName(control) + '|' + Boolean(inert),
      );
      // Send now: a test can end right after its last tap, and e2e closes the page without a pagehide event.
      flush();
      scheduleScan();
    },
    true,
  );

  const parseJson = (text) => {
    if (typeof text !== 'string' || text.length === 0 || text.length > 20000) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.href.startsWith(ENDPOINT)) return originalFetch(input, init);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestJson = parseJson(typeof init?.body === 'string' ? init.body : undefined);
    const response = await originalFetch(input, init);
    try {
      const type = response.headers.get('content-type') ?? '';
      const responseJson = type.includes('json') ? parseJson(await response.clone().text()) : undefined;
      push({
        kind: 'request',
        method,
        path: normalizePath(url.pathname),
        sameOrigin: url.origin === location.origin,
        status: response.status,
        requestJson,
        responseJson,
      });
    } catch {}
    scheduleScan();
    return response;
  };

  const start = () => {
    scan();
    new MutationObserver(scheduleScan).observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
  window.addEventListener('pagehide', () => {
    scan();
    flush();
  });
})();
