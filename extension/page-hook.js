// Se ejecuta dentro de las páginas de Sofascore y Betano (mundo MAIN) antes que
// su propio código. Anota lo que la web descarga para que la extensión pueda
// leerlo sin adivinar direcciones:
//  - las respuestas JSON (partidos, estadísticas, cuotas...);
//  - los encabezados especiales (x-...) que la web añade a sus pedidos.
// No envía nada a ningún lado: todo queda en la memoria de la pestaña.
(() => {
  if (window.__bdpHook) return;
  const site = location.hostname.replace(/^www\./, '').split('.').slice(-2).join('.'); // sofascore.com, betano.pe
  const MAX = 150;
  const hook = { headers: {}, responses: [] };
  Object.defineProperty(window, '__bdpHook', { value: hook });

  const ownSite = (url) => {
    try {
      const host = new URL(url, location.href).hostname;
      return host === site || host.endsWith(`.${site}`) || /sofascore\.(app|com)$/.test(host);
    } catch {
      return false;
    }
  };
  const remember = (url, pairs) => {
    if (!ownSite(url)) return;
    for (const [k, v] of pairs) if (/^x-/i.test(k)) hook.headers[k.toLowerCase()] = v;
  };
  const keep = (url, text) => {
    if (!text || text.length < 20 || !/^\s*[[{]/.test(text)) return;
    hook.responses.push({ url: String(url), text: text.slice(0, 3e6) });
    if (hook.responses.length > MAX) hook.responses.shift();
  };
  const isJson = (type) => /json/i.test(type || '');

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    try {
      remember(url, new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)).entries());
    } catch {
      // encabezados ilegibles: se ignoran
    }
    const p = originalFetch.apply(this, arguments);
    if (ownSite(url)) {
      p.then((r) => isJson(r.headers.get('content-type')) && r.clone().text().then((t) => keep(r.url || url, t))).catch(() => {});
    }
    return p;
  };

  const { open, setRequestHeader, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__bdp = { url, headers: [] };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    this.__bdp?.headers.push([k, v]);
    return setRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__bdp && ownSite(this.__bdp.url)) {
      remember(this.__bdp.url, this.__bdp.headers);
      this.addEventListener('load', () => {
        if ((this.responseType === '' || this.responseType === 'text') && isJson(this.getResponseHeader('content-type'))) {
          keep(this.responseURL || this.__bdp.url, this.responseText);
        }
      });
    }
    return send.apply(this, arguments);
  };
})();
