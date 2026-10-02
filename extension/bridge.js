// Puente entre la página web (GitHub Pages o localhost) y la extensión.
// La página envía window.postMessage({ bdp: 'request', id, action, params })
// y recibe window.postMessage({ bdp: 'response', id, ok, data | error }).
(() => {
  // En github.io solo se conecta con la página de este proyecto.
  if (location.hostname.endsWith('github.io') && !location.pathname.toLowerCase().startsWith('/analisis-bdp')) return;

  const announce = () =>
    window.postMessage({ bdp: 'ready', version: chrome.runtime.getManifest().version }, window.location.origin);

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.bdp !== 'request') return;
    if (msg.action === 'ping') return announce();

    chrome.runtime.sendMessage({ action: msg.action, params: msg.params || {} }, (reply) => {
      const error = chrome.runtime.lastError?.message;
      window.postMessage(
        error ? { bdp: 'response', id: msg.id, ok: false, error } : { bdp: 'response', id: msg.id, ...reply },
        window.location.origin,
      );
    });
  });

  announce();
})();
