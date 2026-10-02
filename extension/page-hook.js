// Se ejecuta dentro de las páginas de Sofascore y Betano (mundo MAIN) antes que
// su propio código. Observa las llamadas que hace la web a su API para que la
// extensión pueda repetirlas igual:
//  - guarda los encabezados especiales (x-...) que la web añade a sus pedidos;
//  - en Betano guarda además las respuestas JSON (ahí vienen las cuotas).
// No envía nada a ningún lado: todo queda en la memoria de la pestaña.
(() => {
  if (window.__bdpHook) return;
  const keepResponses = location.hostname.endsWith('betano.pe');
  const hook = { headers: {}, responses: [] };
  Object.defineProperty(window, '__bdpHook', { value: hook });

  const isApi = (url) => {
    try {
      return /\/api\//.test(new URL(url, location.href).pathname);
    } catch {
      return false;
    }
  };
  const remember = (url, pairs) => {
    if (!isApi(url)) return;
    for (const [k, v] of pairs) if (/^x-/i.test(k)) hook.headers[k.toLowerCase()] = v;
  };
  const keep = (url, text) => {
    if (!keepResponses || !text || text.length < 50 || !/^\s*[[{]/.test(text)) return;
    hook.responses.push({ url: String(url), text: text.slice(0, 2e6) });
    if (hook.responses.length > 25) hook.responses.shift();
  };

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    try {
      const h = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      remember(url, h.entries());
    } catch {
      // encabezados ilegibles: se ignoran
    }
    const p = originalFetch.apply(this, arguments);
    if (keepResponses && isApi(url)) p.then((r) => r.clone().text().then((t) => keep(url, t))).catch(() => {});
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
    if (this.__bdp) {
      remember(this.__bdp.url, this.__bdp.headers);
      if (keepResponses && isApi(this.__bdp.url)) {
        this.addEventListener('load', () => {
          if (this.responseType === '' || this.responseType === 'text') keep(this.__bdp.url, this.responseText);
        });
      }
    }
    return send.apply(this, arguments);
  };
})();
