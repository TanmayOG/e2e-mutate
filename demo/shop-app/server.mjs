/**
 * The e2e-mutate demo app: a small bookshop.
 *
 * Pages: catalog (/), cart (/cart), checkout (/checkout), order confirmation
 * (/order/:id), account with profile and plan (/account), settings (/settings).
 * Every page is client-rendered from a JSON API, so changes to API responses
 * show on screen. State lives in memory per session cookie, so each browser
 * context starts fresh. There are no planted bugs: e2e-mutate plants them at
 * runtime, in the browser, never here.
 *
 * Two routes change the plan (the header "Upgrade" button, and Settings →
 * "Switch to Pro"), as many real apps have.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4320);

const PRODUCTS = [
  { id: 'dune', title: 'Dune', author: 'Frank Herbert', price: 12.5, inStock: true },
  { id: 'neuromancer', title: 'Neuromancer', author: 'William Gibson', price: 17.5, inStock: true },
  { id: 'hyperion', title: 'Hyperion', author: 'Dan Simmons', price: 14, inStock: true },
  { id: 'solaris', title: 'Solaris', author: 'Stanisław Lem', price: 11.25, inStock: false },
];
const ADDRESS = { name: 'Ada Lovelace', line1: '12 St James’s Square', city: 'London', postcode: 'SW1Y 4JH' };

/**
 * @typedef {{ cart: Map<string, number>, profile: { name: string, email: string },
 *   plan: 'free' | 'pro', orders: Map<string, object> }} Session
 * @type {Map<string, Session>}
 */
const sessions = new Map();
let orderSeq = 1041;

function session(req, res) {
  const match = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie ?? '');
  let sid = match?.[1];
  if (!sid || !sessions.has(sid)) {
    sid = randomUUID();
    sessions.set(sid, {
      cart: new Map(),
      profile: { name: 'Ada Lovelace', email: 'ada@example.test' },
      plan: 'free',
      orders: new Map(),
    });
    res.setHeader('set-cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return sessions.get(sid);
}

function cartView(state) {
  const items = [...state.cart].map(([id, qty]) => {
    const product = PRODUCTS.find((p) => p.id === id);
    return { id, title: product.title, price: product.price, qty };
  });
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  return { items, total, count };
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
  :root { --ink: #1c1917; --muted: #78716c; --line: #e7e5e4; --brand: #9a3412; --bg: #fafaf9; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; color: var(--ink); background: var(--bg); }
  header { display: flex; gap: 20px; align-items: center; padding: 14px 28px; background: #fff; border-bottom: 1px solid var(--line); }
  header .logo { font-weight: 700; letter-spacing: -0.02em; color: var(--brand); text-decoration: none; font-size: 18px; }
  header nav { display: flex; gap: 16px; }
  header nav a { color: var(--ink); text-decoration: none; }
  header .spacer { flex: 1; }
  main { padding: 28px; max-width: 760px; }
  h1 { margin: 0 0 16px; font-size: 26px; letter-spacing: -0.02em; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid var(--line); border-radius: 8px; }
  td, th { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  button, .button { font: inherit; padding: 7px 14px; border-radius: 6px; border: 1px solid #a8a29e; background: #fff; cursor: pointer; color: var(--ink); text-decoration: none; display: inline-block; }
  button.primary, .button.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #dcfce7; color: #166534; }
  .badge.out { background: #fee2e2; color: #991b1b; }
  .total { font-size: 20px; margin-top: 16px; }
  .muted { color: var(--muted); }
  .error { color: #b91c1c; }
  .ok { color: #166534; }
  form label { display: block; margin: 12px 0 4px; font-size: 14px; }
  form input { font: inherit; padding: 7px 10px; width: 320px; border: 1px solid #a8a29e; border-radius: 6px; }
  section { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
`;

const SHELL_SCRIPT = `
const money = (n) => '$' + Number(n).toFixed(2);
const upgrade = document.getElementById('upgrade');
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(path + ' answered ' + res.status);
  return res.json();
}
async function refreshHeader() {
  const [{ plan }, cart] = await Promise.all([api('/api/plan'), api('/api/cart')]);
  upgrade.hidden = plan === 'pro';
  document.getElementById('cart-count').textContent = String(cart.count);
  document.dispatchEvent(new CustomEvent('plan', { detail: plan }));
}
async function setPlan(plan) {
  await api('/api/plan', { method: 'POST', body: JSON.stringify({ plan }) });
  await refreshHeader();
}
upgrade.addEventListener('click', async () => {
  const error = document.getElementById('plan-error');
  try { await setPlan('pro'); if (error) error.textContent = ''; }
  catch { if (error) error.textContent = 'Could not change the plan. Try again later.'; }
});
window.shop = { api, money, refreshHeader, setPlan };
refreshHeader();
`;

function page(title, body, script = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · Bookshop</title><style>${STYLE}</style></head>
<body>
<header>
  <a class="logo" href="/">Bookshop</a>
  <nav aria-label="Main">
    <a href="/">Catalog</a>
    <a href="/cart">Cart (<span id="cart-count">0</span>)</a>
    <a href="/account">Account</a>
    <a href="/settings">Settings</a>
  </nav>
  <span class="spacer"></span>
  <button id="upgrade" class="primary" hidden>Upgrade</button>
</header>
<main>${body}</main>
<script type="module">
${SHELL_SCRIPT}
${script}
</script>
</body></html>`;
}

const CATALOG = page(
  'Catalog',
  `<h1>Catalog</h1>
   <table aria-label="Books">
     <thead><tr><th>Book</th><th>Author</th><th>Price</th><th>Stock</th><th></th></tr></thead>
     <tbody id="books"></tbody>
   </table>
   <p role="status" id="added" class="ok"></p>`,
  `const products = await api('/api/products');
   const books = document.getElementById('books');
   books.innerHTML = products.map((p) =>
     '<tr><td>' + p.title + '</td><td class="muted">' + p.author + '</td><td>' + money(p.price) + '</td>' +
     '<td><span class="badge' + (p.inStock ? '' : ' out') + '">' + (p.inStock ? 'In stock' : 'Out of stock') + '</span></td>' +
     '<td>' + (p.inStock ? '<button data-id="' + p.id + '" aria-label="Add ' + p.title + ' to cart">Add to cart</button>' : '') + '</td></tr>'
   ).join('');
   books.addEventListener('click', async (event) => {
     const button = event.target.closest('button[data-id]');
     if (!button) return;
     const status = document.getElementById('added');
     try {
       await api('/api/cart', { method: 'POST', body: JSON.stringify({ id: button.dataset.id }) });
       const title = products.find((p) => p.id === button.dataset.id).title;
       status.className = 'ok';
       status.textContent = 'Added ' + title + ' to your cart';
       await refreshHeader();
     } catch {
       status.className = 'error';
       status.textContent = 'Could not add the book. Try again later.';
     }
   });`,
);

const CART = page(
  'Cart',
  `<h1>Cart</h1>
   <div id="cart"></div>`,
  `async function render() {
     const cart = await api('/api/cart');
     const root = document.getElementById('cart');
     if (cart.items.length === 0) {
       root.innerHTML = '<p class="muted">Your cart is empty.</p>';
       return;
     }
     root.innerHTML =
       '<table aria-label="Cart items"><thead><tr><th>Book</th><th>Price</th><th>Qty</th><th>Line total</th><th></th></tr></thead><tbody id="rows">' +
       cart.items.map((item) =>
         '<tr><td>' + item.title + '</td><td>' + money(item.price) + '</td><td>' + item.qty + '</td><td>' + money(item.price * item.qty) + '</td>' +
         '<td><button data-remove="' + item.id + '" aria-label="Remove ' + item.title + '">Remove</button></td></tr>'
       ).join('') +
       '</tbody></table>' +
       '<p class="total">Total: <strong data-testid="cart-total">' + money(cart.total) + '</strong></p>' +
       '<a class="button primary" href="/checkout">Checkout</a>';
   }
   document.getElementById('cart').addEventListener('click', async (event) => {
     const button = event.target.closest('button[data-remove]');
     if (!button) return;
     await api('/api/cart/' + button.dataset.remove, { method: 'DELETE' });
     await render();
     await refreshHeader();
   });
   render();`,
);

const CHECKOUT = page(
  'Checkout',
  `<h1>Checkout</h1>
   <section aria-labelledby="ship-heading">
     <h2 id="ship-heading">Ship to</h2>
     <p>${ADDRESS.name}<br>${ADDRESS.line1}<br>${ADDRESS.city} ${ADDRESS.postcode}</p>
   </section>
   <section aria-labelledby="summary-heading">
     <h2 id="summary-heading">Order summary</h2>
     <p><span id="summary-count">…</span> · Total <strong data-testid="checkout-total" id="summary-total">…</strong></p>
   </section>
   <button class="primary" id="place">Place order</button>
   <p role="alert" id="order-error" class="error"></p>`,
  `const cart = await api('/api/cart');
   document.getElementById('summary-count').textContent = cart.count + (cart.count === 1 ? ' book' : ' books');
   document.getElementById('summary-total').textContent = money(cart.total);
   document.getElementById('place').addEventListener('click', async () => {
     try {
       const order = await api('/api/order', { method: 'POST', body: '{}' });
       location.href = '/order/' + order.id;
     } catch {
       document.getElementById('order-error').textContent = 'We could not place your order. You have not been charged.';
     }
   });`,
);

const ORDER = page(
  'Order',
  `<h1>Order confirmed</h1>
   <section>
     <p>Order number <strong data-testid="order-number" id="number">…</strong></p>
     <p>Status: <span role="status" id="status">…</span></p>
     <p>Total paid <strong data-testid="order-total" id="paid">…</strong></p>
     <p class="muted" id="ship"></p>
   </section>`,
  `const id = location.pathname.split('/').pop();
   const order = await api('/api/order/' + id);
   document.getElementById('number').textContent = order.number;
   document.getElementById('status').textContent = order.status;
   document.getElementById('paid').textContent = money(order.total);
   document.getElementById('ship').textContent = 'Ships to ' + order.address.name + ', ' + order.address.city;`,
);

const ACCOUNT = page(
  'Account',
  `<h1>Account</h1>
   <section aria-labelledby="profile-heading">
     <h2 id="profile-heading">Profile</h2>
     <form id="profile">
       <label for="name">Name</label><input id="name" name="name" autocomplete="off">
       <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="off">
       <p><button class="primary" type="submit">Save</button></p>
       <p role="status" id="profile-status"></p>
     </form>
   </section>
   <section aria-labelledby="plan-heading">
     <h2 id="plan-heading">Plan</h2>
     <p>Current plan: <strong id="plan-name">…</strong></p>
     <p role="alert" id="plan-error" class="error"></p>
   </section>`,
  `const profile = await api('/api/profile');
   document.getElementById('name').value = profile.name;
   document.getElementById('email').value = profile.email;
   document.addEventListener('plan', (e) => {
     document.getElementById('plan-name').textContent = e.detail === 'pro' ? 'Pro' : 'Free';
   });
   document.getElementById('profile').addEventListener('submit', async (event) => {
     event.preventDefault();
     const status = document.getElementById('profile-status');
     try {
       await api('/api/profile', {
         method: 'PUT',
         body: JSON.stringify({ name: document.getElementById('name').value, email: document.getElementById('email').value }),
       });
       status.className = 'ok';
       status.textContent = 'Profile saved';
     } catch {
       status.className = 'error';
       status.textContent = 'Could not save your profile.';
     }
   });`,
);

const SETTINGS = page(
  'Settings',
  `<h1>Settings</h1>
   <section aria-labelledby="plan-heading">
     <h2 id="plan-heading">Plan</h2>
     <p>Current plan: <strong id="plan-name">…</strong></p>
     <button id="switch">Switch to Pro</button>
     <p role="alert" id="plan-error" class="error"></p>
   </section>`,
  `document.addEventListener('plan', (e) => {
     document.getElementById('plan-name').textContent = e.detail === 'pro' ? 'Pro' : 'Free';
     document.getElementById('switch').hidden = e.detail === 'pro';
   });
   document.getElementById('switch').addEventListener('click', async () => {
     const error = document.getElementById('plan-error');
     try { await setPlan('pro'); error.textContent = ''; }
     catch { error.textContent = 'Could not change the plan. Try again later.'; }
   });`,
);

const PAGES = { '/': CATALOG, '/cart': CART, '/checkout': CHECKOUT, '/account': ACCOUNT, '/settings': SETTINGS };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const state = session(req, res);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/products') return json(res, 200, PRODUCTS);
  if (route === 'GET /api/cart') return json(res, 200, cartView(state));
  if (route === 'POST /api/cart') {
    const { id } = await readJson(req);
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product || !product.inStock) return json(res, 400, { error: 'not available' });
    state.cart.set(id, (state.cart.get(id) ?? 0) + 1);
    return json(res, 200, cartView(state));
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/cart/')) {
    state.cart.delete(url.pathname.slice('/api/cart/'.length));
    return json(res, 200, cartView(state));
  }
  if (route === 'POST /api/order') {
    const cart = cartView(state);
    if (cart.items.length === 0) return json(res, 400, { error: 'cart is empty' });
    const order = {
      id: randomUUID(),
      number: `BK-${orderSeq++}`,
      status: 'Confirmed',
      items: cart.items,
      total: cart.total,
      address: ADDRESS,
    };
    state.orders.set(order.id, order);
    state.cart.clear();
    return json(res, 200, order);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/order/')) {
    const order = state.orders.get(url.pathname.slice('/api/order/'.length));
    return order ? json(res, 200, order) : json(res, 404, { error: 'no such order' });
  }
  if (route === 'GET /api/profile') return json(res, 200, state.profile);
  if (route === 'PUT /api/profile') {
    const { name, email } = await readJson(req);
    if (typeof name !== 'string' || name.trim() === '') return json(res, 400, { error: 'name is required' });
    state.profile = { name: name.trim(), email: String(email ?? state.profile.email) };
    return json(res, 200, state.profile);
  }
  if (route === 'GET /api/plan') return json(res, 200, { plan: state.plan });
  if (route === 'POST /api/plan') {
    const { plan } = await readJson(req);
    if (plan !== 'pro' && plan !== 'free') return json(res, 400, { error: 'unknown plan' });
    state.plan = plan;
    return json(res, 200, { plan: state.plan });
  }

  const html = url.pathname.startsWith('/order/') ? ORDER : PAGES[url.pathname];
  if (req.method !== 'GET' || !html) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => console.log(`bookshop on http://127.0.0.1:${PORT}`));
