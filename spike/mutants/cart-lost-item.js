// Mutant: the cart API lost an item. GET /api/cart drops Neuromancer, and the
// total it returns matches what is left ($25.00), the way a backend that never
// saved the item would answer. The screen stays self-consistent but is wrong.
(() => {
  const MUTANT = 'cart-lost-item';
  const report = () => {
    const payload = JSON.stringify({ mutant: MUTANT, at: Date.now(), path: location.pathname });
    try { navigator.sendBeacon('http://127.0.0.1:4399/applied', payload); } catch {}
    console.info('[e2e-mutate] applied ' + MUTANT);
  };

  const original = window.fetch;
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const response = await original.apply(this, arguments);
    if (url.pathname !== '/api/cart' || method !== 'GET' || !response.ok) return response;
    const cart = await response.clone().json();
    const items = cart.items.filter((item) => item.id !== 'neuromancer');
    if (items.length === cart.items.length) return response;
    report();
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    return new Response(JSON.stringify({ ...cart, items, total }), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  };
})();
