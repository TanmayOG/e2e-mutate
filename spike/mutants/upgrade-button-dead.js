// Mutant: dead control. The header's "Upgrade" button does nothing when clicked.
(() => {
  const MUTANT = 'upgrade-button-dead';
  const report = () => {
    const payload = JSON.stringify({ mutant: MUTANT, at: Date.now(), path: location.pathname });
    try { navigator.sendBeacon('http://127.0.0.1:4399/applied', payload); } catch {}
    console.info('[e2e-mutate] applied ' + MUTANT);
  };

  window.addEventListener(
    'click',
    (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || !button.closest('header') || button.textContent.trim() !== 'Upgrade') return;
      event.stopImmediatePropagation();
      event.preventDefault();
      report();
    },
    true,
  );
})();
