/**
 * Spike app for e2e-mutate: a workspace with a plan you can upgrade two ways
 * (the header "Upgrade" button, or Settings → "Switch to Pro"), and a cart
 * whose total comes from the API. Client-rendered, so API changes show on
 * screen. State lives in memory per session cookie, so each browser context
 * starts fresh. No planted bugs: mutants are injected by the tests' init
 * scripts, never here.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4310);

/** @type {Map<string, { plan: 'free' | 'pro' }>} */
const sessions = new Map();

const CART = [
  { id: 'dune', title: 'Dune', price: 12.5, qty: 2 },
  { id: 'neuromancer', title: 'Neuromancer', price: 17.5, qty: 1 },
];

function session(req, res) {
  const match = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie ?? '');
  let sid = match?.[1];
  if (!sid || !sessions.has(sid)) {
    sid = randomUUID();
    sessions.set(sid, { plan: 'free' });
    res.setHeader('set-cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return sessions.get(sid);
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; color: #1d1d1f; }
  header { display: flex; gap: 16px; align-items: center; padding: 12px 24px; border-bottom: 1px solid #ddd; }
  header .spacer { flex: 1; }
  main { padding: 24px; max-width: 640px; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid #888; background: #fff; cursor: pointer; }
  button.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  .error { color: #b91c1c; }
`;

function page(title, body, script) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · Workspace</title><style>${STYLE}</style></head>
<body>
<header>
  <a href="/">Home</a>
  <a href="/cart">Cart</a>
  <a href="/settings">Settings</a>
  <span class="spacer"></span>
  <button id="upgrade" class="primary" hidden>Upgrade</button>
</header>
<main>${body}</main>
<script type="module">
const upgrade = document.getElementById('upgrade');
async function loadPlan() {
  const res = await fetch('/api/plan');
  const { plan } = await res.json();
  upgrade.hidden = plan === 'pro';
  document.dispatchEvent(new CustomEvent('plan', { detail: plan }));
  return plan;
}
async function setPlan(plan) {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) throw new Error('plan change failed: ' + res.status);
  await loadPlan();
}
window.workspace = { loadPlan, setPlan };
upgrade.addEventListener('click', async () => {
  const error = document.getElementById('error');
  try { await setPlan('pro'); if (error) error.textContent = ''; }
  catch { if (error) error.textContent = 'Could not change the plan. Try again later.'; }
});
loadPlan();
${script}
</script>
</body></html>`;
}

const HOME = page(
  'Home',
  `<h1>Your workspace</h1>
   <p role="status" id="plan">Current plan: …</p>
   <p role="alert" id="error" class="error"></p>`,
  `document.addEventListener('plan', (e) => {
     document.getElementById('plan').textContent = 'Current plan: ' + (e.detail === 'pro' ? 'Pro' : 'Free');
   });`,
);

const SETTINGS = page(
  'Settings',
  `<h1>Settings</h1>
   <section aria-labelledby="plan-heading">
     <h2 id="plan-heading">Plan</h2>
     <p role="status" id="plan">Current plan: …</p>
     <button id="switch">Switch to Pro</button>
     <p role="alert" id="error" class="error"></p>
   </section>`,
  `document.addEventListener('plan', (e) => {
     document.getElementById('plan').textContent = 'Current plan: ' + (e.detail === 'pro' ? 'Pro' : 'Free');
     document.getElementById('switch').hidden = e.detail === 'pro';
   });
   document.getElementById('switch').addEventListener('click', async () => {
     const error = document.getElementById('error');
     try { await window.workspace.setPlan('pro'); error.textContent = ''; }
     catch { error.textContent = 'Could not change the plan. Try again later.'; }
   });`,
);

const CART_PAGE = page(
  'Cart',
  `<h1>Cart</h1>
   <table aria-label="Cart items">
     <thead><tr><th>Book</th><th>Price</th><th>Qty</th><th>Line total</th></tr></thead>
     <tbody id="rows"></tbody>
   </table>
   <p>Total: <strong data-testid="cart-total" id="total">…</strong></p>`,
  `const money = (n) => '$' + n.toFixed(2);
   const res = await fetch('/api/cart');
   const cart = await res.json();
   document.getElementById('rows').innerHTML = cart.items.map((item) =>
     '<tr><td>' + item.title + '</td><td>' + money(item.price) + '</td><td>' + item.qty + '</td><td>' + money(item.price * item.qty) + '</td></tr>'
   ).join('');
   document.getElementById('total').textContent = money(cart.total);`,
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const state = session(req, res);

  if (url.pathname === '/api/plan' && req.method === 'GET') return json(res, 200, { plan: state.plan });
  if (url.pathname === '/api/plan' && req.method === 'POST') {
    const body = await readJson(req);
    if (body.plan !== 'pro' && body.plan !== 'free') return json(res, 400, { error: 'unknown plan' });
    state.plan = body.plan;
    return json(res, 200, { plan: state.plan });
  }
  if (url.pathname === '/api/cart' && req.method === 'GET') {
    const total = CART.reduce((sum, item) => sum + item.price * item.qty, 0);
    return json(res, 200, { items: CART, total });
  }

  const pages = { '/': HOME, '/settings': SETTINGS, '/cart': CART_PAGE };
  const html = pages[url.pathname];
  if (!html) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`spike app on http://127.0.0.1:${PORT}`);
});
