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

export async function fetchDirect(url, { headers = {}, as = 'json', timeout = 25000 } = {}) {
  const resp = await fetch(url, { headers, credentials: 'include', signal: AbortSignal.timeout(timeout) });
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

// Navega una pestaña a `url` y espera a que termine de cargar.
function goTo(tabId, url) {
  return new Promise((resolve, reject) => {
    let started = false;
    const done = (fn, arg) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new FetchError('La pestaña tardó demasiado en cargar', { mode: 'tab', url })), TAB_LOAD_TIMEOUT);
    function listener(id, info) {
      if (id !== tabId) return;
      if (info.status === 'loading') started = true;
      if (started && info.status === 'complete') done(resolve);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((e) => done(reject, e));
  });
}

// Pestañas que Chrome "durmió" (ahorro de memoria) no sirven: no ejecutan nada.
const awake = (t) => !t.discarded && t.status !== 'unloaded' && !t.frozen;

// Ejecuta `func(...args)` dentro de una pestaña de `pageUrl` (contexto de la
// página). Usa una pestaña del sitio que ya tengas abierta; si no hay, abre una
// en segundo plano que se cierra sola tras un minuto sin uso.
//  ownOnly: usar solo pestañas abiertas por la extensión.
//  navigate: llevar la pestaña exactamente a `pageUrl` antes de ejecutar.
export async function runInSiteTab(pageUrl, func, args = [], { ownOnly = false, navigate = false } = {}) {
  const origin = new URL(pageUrl).origin;
  const own = await ownTabs();
  const open = (await chrome.tabs.query({ url: `${origin}/*` })).filter(awake);
  let tab = ownOnly ? open.find((t) => own[t.id]) : open.find((t) => !own[t.id]) || open[0];
  const isOwn = !tab || Boolean(own[tab.id]);
  let fresh = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: pageUrl, active: false });
    fresh = true;
  }
  try {
    if (navigate && !fresh) await goTo(tab.id, pageUrl);
    else await waitForTabComplete(tab.id);
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
  const extra = window.__bdpHook ? { ...window.__bdpHook.headers } : {};
  try {
    const resp = await fetch(url, { headers: { ...extra, ...headers }, credentials: 'include' });
    const text = await resp.text();
    return { status: resp.status, ok: resp.ok, text };
  } catch (e) {
    // Bloqueado (CORS, red...): se informa en vez de devolver nada.
    return { status: 0, ok: false, text: '', error: String(e?.message || e) };
  }
}

async function pageFetchMany(requests, concurrency) {
  // Encabezados especiales que la propia web añade a su API (los anota page-hook.js).
  const hook = window.__bdpHook;
  if (hook && !Object.keys(hook.headers).length) {
    const end = Date.now() + 4000;
    while (Date.now() < end && !Object.keys(hook.headers).length) await new Promise((r) => setTimeout(r, 250));
  }
  const extra = hook ? { ...hook.headers } : {};
  const out = new Array(requests.length);
  let next = 0;
  async function worker() {
    while (next < requests.length) {
      const i = next++;
      try {
        const resp = await fetch(requests[i].url, { headers: { ...extra, ...(requests[i].headers || {}) }, credentials: 'include' });
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
  if (r.error) throw new FetchError(`desde la pestaña: ${r.error}`, { mode: 'tab', url });
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
const mostlyBlocked = (raws) => raws.filter(isBlocked).length > raws.length / 2;

const describe = (raw) => raw.error || `HTTP ${raw.status}`;
const MODE_NAME = { direct: 'directo', tab: 'pestaña' };

// Peticiones marcadas como `required` deben existir (p. ej. la lista de
// partidos del día): si todas fallan, incluso con 404, se prueba el siguiente
// modo. Algunos sitios responden 404 en vez de 403 cuando rechazan el pedido.
const hardFail = (raw) => isBlocked(raw) || raw.status === 404;
function requiredFailed(requests, raws) {
  const idx = requests.map((r, j) => (r.required ? j : -1)).filter((j) => j >= 0);
  return idx.length > 0 && idx.every((j) => hardFail(raws[j]));
}

// Hace muchas peticiones al mismo sitio. Devuelve un resultado por petición
// ({ ok, status, data | error }); solo lanza error si el sitio no responde en
// ningún modo. Modos, en orden: "direct" y "tab" (todas en una pestaña del sitio).
export async function fetchMany(requests, { pageUrl, modes = ['direct', 'tab'], concurrency = 6 } = {}) {
  if (!requests.length) return { mode: null, results: [], notes: [] };
  const origin = new URL(requests[0].url).origin;
  const pref = preferred.get(origin);
  const order = pref && modes.includes(pref) ? modes.slice(modes.indexOf(pref)) : modes;
  const notes = [];
  let lastStatus;
  for (const [i, mode] of order.entries()) {
    const isLast = i === order.length - 1;
    let raw;
    try {
      if (mode === 'direct') {
        const first = await rawDirect(requests[0]);
        if ((isBlocked(first) || (requests[0].required && first.status === 404)) && !isLast) {
          notes.push(`directo: ${describe(first)}`);
          lastStatus = first.status;
          continue;
        }
        raw = [first, ...(await pool(requests.slice(1), rawDirect, concurrency))];
      } else {
        raw = await runInSiteTab(pageUrl, pageFetchMany, [requests.map(({ url, headers }) => ({ url, headers: headers || {} })), concurrency]);
        if (!Array.isArray(raw)) throw new FetchError('No se pudo ejecutar en la pestaña');
      }
    } catch (e) {
      notes.push(`${MODE_NAME[mode]}: ${e.message}`);
      continue;
    }
    const failedRequired = requiredFailed(requests, raw);
    if ((mostlyBlocked(raw) || failedRequired) && !isLast) {
      const bad = raw.find(hardFail) || raw[0];
      notes.push(`${MODE_NAME[mode]}: ${describe(bad)}`);
      lastStatus = bad.status;
      continue;
    }
    if (!failedRequired) preferred.set(origin, mode);
    return { mode, results: raw.map((r, j) => toResult(r, requests[j].as)), notes };
  }
  throw new FetchError(notes.join(' | ') || 'Sin respuesta', { status: lastStatus, mode: order.at(-1) });
}

// ---- Leer una página como la ve el usuario ----

// Corre dentro de la página: espera a que la web termine de pedir sus datos,
// baja por la página `scrolls` veces (carga más contenido) y devuelve las
// respuestas JSON que anotó page-hook.js. No puede usar nada de fuera.
async function collectResponses(waitMs, scrolls) {
  const hook = window.__bdpHook;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const end = Date.now() + waitMs;
  let last = -1;
  let stable = 0;
  while (Date.now() < end) {
    const n = hook?.responses?.length || 0;
    stable = n > 0 && n === last ? stable + 1 : 0;
    if (stable >= 4) break; // 2 s sin respuestas nuevas
    last = n;
    await sleep(500);
  }
  for (let i = 0; i < scrolls; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(900);
  }
  if (scrolls) {
    window.scrollTo(0, 0);
    await sleep(1500);
  }
  return {
    url: location.href,
    title: document.title,
    hooked: Boolean(hook),
    responses: (hook?.responses || []).map((r) => ({ url: r.url, text: r.text })),
  };
}

// Abre `url` en la pestaña de la extensión y devuelve lo que la web descargó:
// { url, title, hooked, responses: [{ url, data }] }.
export async function scanPage(url, { waitMs = 15000, scrolls = 0 } = {}) {
  const r = await runInSiteTab(url, collectResponses, [waitMs, scrolls], { ownOnly: true, navigate: true });
  if (!r) throw new FetchError('No se pudo leer la página', { mode: 'scan', url });
  const responses = [];
  for (const x of r.responses) {
    try {
      responses.push({ url: x.url, data: JSON.parse(x.text) });
    } catch {
      // respuesta que no es JSON
    }
  }
  return { url: r.url, title: r.title, hooked: r.hooked, responses };
}
