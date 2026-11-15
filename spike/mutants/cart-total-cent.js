// Mutant: wrong number. On /cart, "$42.50" shows as "$42.49" wherever it appears.
(() => {
  const MUTANT = 'cart-total-cent';
  const FROM = '$42.50';
  const TO = '$42.49';
  if (location.pathname !== '/cart') return;

  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    const payload = JSON.stringify({ mutant: MUTANT, at: Date.now(), path: location.pathname });
    try { navigator.sendBeacon('http://127.0.0.1:4399/applied', payload); } catch {}
    console.info('[e2e-mutate] applied ' + MUTANT);
  };

  const rewriteText = (node) => {
    if (node.nodeValue && node.nodeValue.includes(FROM)) {
      node.nodeValue = node.nodeValue.split(FROM).join(TO);
      report();
    }
  };
  const rewrite = (root) => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return rewriteText(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) rewriteText(node);
  };

  const start = () => {
    rewrite(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') rewrite(record.target);
        for (const added of record.addedNodes) rewrite(added);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
