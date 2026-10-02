// Formas de pedir datos a un sitio:
//  - direct: fetch desde la extensión (sin CORS gracias a host_permissions).
//  - tab: abre (o reutiliza) una pestaña del sitio y ejecuta el fetch dentro
//    de la página, con sus cookies y su sesión, como si navegaras tú.
// fetchData prueba "direct" y, si el sitio lo rechaza, pasa a "tab".

const TAB_LOAD_TIMEOUT = 30000;

export class FetchError extends Error {
  constructor(message, { status, mode, url, snippet } = {}) {
    super(message);
    Object.assign(this, { status, mode, url, snippet });
  }
}

function parseBody(text, as) {
  if (as === 'text') return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new FetchError('La respuesta no es JSON', { snippet: text.slice(0, 300) });
  }
}

export async function fetchDirect(url, { headers = {}, as = 'json' } = {}) {
  const resp = await fetch(url, { headers, credentials: 'include', signal: AbortSignal.timeout(25000) });
  const text = await resp.text();
  if (!resp.ok) throw new FetchError(`HTTP ${resp.status}`, { status: resp.status, mode: 'direct', url, snippet: text.slice(0, 300) });
  return parseBody(text, as);
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new FetchError('La pestaña tardó demasiado en cargar', { mode: 'tab' }));
    }, TAB_LOAD_TIMEOUT);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') listener(tabId, { status: 'complete' });
    });
  });
}

// Ejecuta `func(...args)` dentro de una pestaña de `pageUrl` (contexto de la
// página). Reutiliza una pestaña abierta del mismo sitio si existe; si no,
// abre una en segundo plano y la cierra al terminar.
export async function runInSiteTab(pageUrl, func, args = []) {
  const origin = new URL(pageUrl).origin;
  const [existing] = await chrome.tabs.query({ url: `${origin}/*` });
  let tabId = existing?.id;
  let created = false;
  if (!tabId) {
    const tab = await chrome.tabs.create({ url: pageUrl, active: false });
    tabId = tab.id;
    created = true;
  }
  try {
    await waitForTabComplete(tabId);
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    return res?.result;
  } finally {
    if (created) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// Función que corre dentro de la página del sitio.
async function pageFetch(url, headers) {
  const resp = await fetch(url, { headers, credentials: 'include' });
  const text = await resp.text();
  return { status: resp.status, ok: resp.ok, text };
}

export async function fetchInTab(pageUrl, url, { headers = {}, as = 'json' } = {}) {
  const r = await runInSiteTab(pageUrl, pageFetch, [url, headers]);
  if (!r) throw new FetchError('No se pudo ejecutar en la pestaña', { mode: 'tab', url });
  if (!r.ok) throw new FetchError(`HTTP ${r.status}`, { status: r.status, mode: 'tab', url, snippet: r.text.slice(0, 300) });
  return parseBody(r.text, as);
}

// Lee una variable global de la página (p. ej. el estado inicial que algunas
// webs incrustan en el HTML), esperando hasta `waitMs` a que aparezca.
export async function readPageGlobal(pageUrl, path, waitMs = 15000) {
  const value = await runInSiteTab(
    pageUrl,
    async (path, waitMs) => {
      const get = () => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window);
      const end = Date.now() + waitMs;
      while (Date.now() < end) {
        const v = get();
        if (v !== undefined) return JSON.parse(JSON.stringify(v));
        await new Promise((r) => setTimeout(r, 500));
      }
      return { __missing: true, title: document.title, text: document.body?.innerText?.slice(0, 300) || '' };
    },
    [path, waitMs],
  );
  if (value?.__missing)
    throw new FetchError(`No apareció ${path} en la página`, { mode: 'tab', url: pageUrl, snippet: `${value.title} | ${value.text}` });
  return value;
}

// Intenta "direct" y, si falla por bloqueo, repite dentro de una pestaña del sitio.
export async function fetchData(url, { pageUrl, headers = {}, as = 'json', modes = ['direct', 'tab'] } = {}) {
  let lastError;
  for (const mode of modes) {
    try {
      const data = mode === 'direct' ? await fetchDirect(url, { headers, as }) : await fetchInTab(pageUrl, url, { headers, as });
      return { data, mode };
    } catch (e) {
      lastError = e instanceof FetchError ? e : new FetchError(e.message, { mode, url });
      lastError.mode ||= mode;
    }
  }
  throw lastError;
}
