// Mutant: server error. POST /api/plan answers 500 without reaching the server.
(() => {
  const MUTANT = 'plan-post-500';
  const report = () => {
    const payload = JSON.stringify({ mutant: MUTANT, at: Date.now(), path: location.pathname });
    try { navigator.sendBeacon('http://127.0.0.1:4399/applied', payload); } catch {}
    console.info('[e2e-mutate] applied ' + MUTANT);
  };

  const original = window.fetch;
  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.pathname === '/api/plan' && method === 'POST') {
      report();
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'internal' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return original.apply(this, arguments);
  };
})();
