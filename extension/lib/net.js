// Formas de pedir datos a un sitio:
//  - direct: fetch desde la extensión (sin CORS gracias a host_permissions).
//  - tab: ejecuta el fetch dentro de una pestaña del sitio, con sus cookies y
//    su sesión, como si navegaras tú. Si no hay una pestaña del sitio abierta,
//    se abre una en segundo plano y se cierra sola tras un minuto sin uso.
// fetchData y fetchMany prueban "direct" y, si el sitio lo rechaza, pasan a "tab".

const TAB_LOAD_TIMEOUT = 30000;
const TAB_IDLE_MS = 60000;
export const CLOSE_TABS_ALARM = 'cerrar-pestanas';

// Modo que funcionó por última vez en cada sitio, para no repetir intentos fallidos.
const preferred = new Map();

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

// ---- Pestañas abiertas por la extensión ----

async function ownTabs() {
  const { ownTabs = {} } = await chrome.storage.session.get('ownTabs');
  return ownTabs;
}

async function markTabUsed(tabId) {
  const tabs = await ownTabs();
  tabs[tabId] = Date.now();
  await chrome.storage.session.set({ ownTabs: tabs });
  await chrome.alarms.create(CLOSE_TABS_ALARM, { delayInMinutes: 1 });
}

// Cierra las pestañas que abrió la extensión y llevan un minuto sin usarse.
export async function closeIdleTabs() {
  const tabs = await ownTabs();
  const now = Date.now();
  let remaining = 0;
  for (const [id, lastUsed] of Object.entries(tabs)) {
    if (now - lastUsed >= TAB_IDLE_MS - 5000) {
      await chrome.tabs.remove(Number(id)).catch(() => {});
      delete tabs[id];
    } else {
      remaining++;
    }
  }
  await chrome.storage.session.set({ ownTabs: tabs });
  if (remaining) await chrome.alarms.create(CLOSE_TABS_ALARM, { delayInMinutes: 1 });
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
    chrome.tabs.get(tabId).then(
      (t) => t.status === 'complete' && listener(tabId, { status: 'complete' }),
      () => listener(tabId, { status: 'complete' }), // la pestaña ya no existe: executeScript dará el error
    );
  });
}

// Ejecuta `func(...args)` dentro de una pestaña de `pageUrl` (contexto de la
// página). Usa una pestaña del sitio que ya tengas abierta; si no hay, abre una
// en segundo plano que se cierra sola tras un minuto sin uso.
export async function runInSiteTab(pageUrl, func, args = []) {
  const origin = new URL(pageUrl).origin;
  const own = await ownTabs();
  const open = await chrome.tabs.query({ url: `${origin}/*` });
  let tab = open.find((t) => !own[t.id]) || open[0];
  const isOwn = !tab || Boolean(own[tab.id]);
  if (!tab) tab = await chrome.tabs.create({ url: pageUrl, active: false });
  try {
    await waitForTabComplete(tab.id);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func, args });
    return res?.result;
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError(`La página ${origin} no cargó (sin conexión o bloqueada): ${e.message}`, { mode: 'tab', url: pageUrl });
  } finally {
    if (isOwn) await markTabUsed(tab.id).catch(() => {});
  }
}

// Funciones que corren dentro de la página del sitio (no pueden usar nada de fuera).
async function pageFetch(url, headers) {
  const resp = await fetch(url, { headers, credentials: 'include' });
  const text = await resp.text();
  return { status: resp.status, ok: resp.ok, text };
}

async function pageFetchMany(requests, concurrency) {
  const out = new Array(requests.length);
  let next = 0;
  async function worker() {
    while (next < requests.length) {
      const i = next++;
      try {
        const resp = await fetch(requests[i].url, { headers: requests[i].headers || {}, credentials: 'include' });
        out[i] = { status: resp.status, ok: resp.ok, text: await resp.text() };
      } catch (e) {
        out[i] = { status: 0, ok: false, text: '', error: String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
  return out;
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

// Intenta "direct" y, si falla, repite dentro de una pestaña del sitio.
export async function fetchData(url, { pageUrl, headers = {}, as = 'json', modes = ['direct', 'tab'] } = {}) {
  const origin = new URL(url).origin;
  const order = preferred.get(origin) === 'tab' && modes.includes('tab') ? ['tab'] : modes;
  const errors = [];
  for (const mode of order) {
    try {
      const data = mode === 'direct' ? await fetchDirect(url, { headers, as }) : await fetchInTab(pageUrl, url, { headers, as });
      if (modes.length > 1) preferred.set(origin, mode);
      return { data, mode };
    } catch (e) {
      errors.push(e instanceof FetchError ? e : new FetchError(e.message, { mode, url }));
      errors.at(-1).mode ||= mode;
    }
  }
  // Se informa el motivo de cada intento; el estado y la respuesta, del primero que los tenga.
  const first = errors.find((e) => e.status) || errors[0];
  throw new FetchError(errors.map((e) => `${e.mode}: ${e.message}`).join(' | '), { status: first.status, mode: first.mode, url, snippet: first.snippet });
}

// ---- Varias peticiones a la vez ----

async function pool(items, worker, concurrency) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return out;
}

async function rawDirect({ url, headers = {} }) {
  try {
    const resp = await fetch(url, { headers, credentials: 'include', signal: AbortSignal.timeout(25000) });
    return { status: resp.status, ok: resp.ok, text: await resp.text() };
  } catch (e) {
    return { status: 0, ok: false, text: '', error: e.message };
  }
}

function toResult(raw, as) {
  if (!raw?.ok) return { ok: false, status: raw?.status ?? 0, error: raw?.error || `HTTP ${raw?.status}`, snippet: (raw?.text || '').slice(0, 200) };
  if (as === 'text') return { ok: true, status: raw.status, data: raw.text };
  try {
    return { ok: true, status: raw.status, data: JSON.parse(raw.text) };
  } catch {
    return { ok: false, status: raw.status, error: 'La respuesta no es JSON', snippet: raw.text.slice(0, 200) };
  }
}

// Un 404 es una respuesta válida (p. ej. un partido sin cuotas); estos no.
const isBlocked = (raw) => [0, 401, 403, 429].includes(raw.status);

// Hace muchas peticiones al mismo sitio. Devuelve un resultado por petición
// ({ ok, status, data | error }); solo lanza error si el sitio no responde en
// ningún modo. En modo "tab" todas se ejecutan en una sola pestaña.
export async function fetchMany(requests, { pageUrl, modes = ['direct', 'tab'], concurrency = 6 } = {}) {
  if (!requests.length) return { mode: null, results: [] };
  const origin = new URL(requests[0].url).origin;
  const order = preferred.get(origin) === 'tab' && modes.includes('tab') ? ['tab'] : modes;
  let directError = null;
  for (const mode of order) {
    if (mode === 'direct') {
      const first = await rawDirect(requests[0]);
      if (isBlocked(first)) {
        directError = first;
        continue;
      }
      const rest = await pool(requests.slice(1), rawDirect, concurrency);
      preferred.set(origin, 'direct');
      return { mode, results: [first, ...rest].map((r, i) => toResult(r, requests[i].as)) };
    }
    try {
      const raw = await runInSiteTab(pageUrl, pageFetchMany, [requests.map(({ url, headers }) => ({ url, headers: headers || {} })), concurrency]);
      if (!Array.isArray(raw)) throw new FetchError('No se pudo ejecutar en la pestaña', { mode: 'tab' });
      preferred.set(origin, 'tab');
      return { mode: 'tab', results: raw.map((r, i) => toResult(r, requests[i].as)) };
    } catch (e) {
      const prefix = directError ? `direct: ${directError.error || `HTTP ${directError.status}`} | ` : '';
      throw new FetchError(`${prefix}tab: ${e.message}`, { status: directError?.status, mode: 'tab', snippet: e.snippet });
    }
  }
  throw new FetchError(`direct: ${directError?.error || `HTTP ${directError?.status}`}`, {
    status: directError?.status,
    mode: 'direct',
    snippet: (directError?.text || '').slice(0, 200),
  });
}
