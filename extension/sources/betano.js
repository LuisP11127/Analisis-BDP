// Betano Perú: cuotas. Solo responde a conexiones desde Perú, por
// eso se consulta dentro de una pestaña de betano.pe (tu navegador).
// La estructura exacta no se ha podido verificar desde fuera de Perú: el
// parser busca en el JSON cualquier evento con mercados y selecciones con
// precio, y el diagnóstico informa qué encontró para ajustarlo.
import { fetchInTab, runInSiteTab } from '../lib/net.js';
import { findAll, toIso } from '../lib/model.js';

const BASE = 'https://www.betano.pe';
// Ruta de cada deporte de Sofascore en Betano.
const PATHS = {
  football: 'futbol',
  basketball: 'baloncesto',
  tennis: 'tenis',
  baseball: 'beisbol',
  'ice-hockey': 'hockey-sobre-hielo',
  'american-football': 'futbol-americano',
  volleyball: 'voleibol',
  handball: 'balonmano',
  'table-tennis': 'tenis-de-mesa',
  esports: 'esports',
  mma: 'mma',
  rugby: 'rugby',
  darts: 'dardos',
  snooker: 'snooker',
  badminton: 'badminton',
  waterpolo: 'waterpolo',
  futsal: 'futsal',
  floorball: 'floorball',
  cricket: 'criquet',
  'aussie-rules': 'futbol-australiano',
  'beach-volley': 'voley-playa',
};
const pageFor = (sport) => `${BASE}/sport/${PATHS[sport] || 'futbol'}/`;
const apiCandidates = (sport) => [
  `${BASE}/api/sport/${PATHS[sport] || 'futbol'}/proximas-24-horas/?req=la,s,stnf,c,mb`,
  `${BASE}/api/sport/${PATHS[sport] || 'futbol'}/?req=la,s,stnf,c,mb`,
];

const priceOf = (s) => Number(s.price ?? s.odds ?? s.decimalOdds);

function isEvent(o) {
  return Array.isArray(o.markets) && o.markets.some((m) => Array.isArray(m?.selections) && m.selections.some((s) => priceOf(s) > 1));
}

function toOdds(e, page) {
  const names = (e.participants || []).map((p) => p.name).filter(Boolean);
  const [home, away] = names.length >= 2 ? names : String(e.name || e.shortName || '').split(/\s+-\s+|\s+vs\.?\s+/i);
  return {
    source: 'betano',
    eventId: String(e.id ?? ''),
    start: toIso(e.startTime ?? e.startDate ?? e.date),
    league: e.leagueName || e.league?.name || '',
    country: e.regionName || e.region?.name || '',
    home: home || '',
    away: away || '',
    url: e.url ? new URL(e.url, page).href : null,
    markets: e.markets
      .filter((m) => Array.isArray(m?.selections))
      .map((m) => ({
        name: m.name || m.type || '',
        type: m.type || '',
        selections: m.selections.map((s) => ({ name: s.name || s.fullName || '', price: priceOf(s) })).filter((s) => s.price > 1),
      })),
  };
}

// Corre dentro de la página de Betano: espera a que la web cargue sus datos y
// devuelve el estado inicial incrustado y las respuestas de su API (las anota
// page-hook.js). No puede usar nada de fuera de la función.
async function collectInPage(waitMs) {
  const KEYS = ['initial_state', '__NEXT_DATA__', '__INITIAL_STATE__', '__NUXT__', '__PRELOADED_STATE__', '__APOLLO_STATE__'];
  const end = Date.now() + waitMs;
  const ready = () => KEYS.some((k) => window[k]) || (window.__bdpHook?.responses?.length || 0) > 0;
  while (Date.now() < end && !ready()) await new Promise((r) => setTimeout(r, 500));
  // Bajar por la página hace que la web cargue más ligas; luego se espera a las cuotas.
  for (let i = 0; i < 4; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 800));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 2000));
  const sources = [];
  for (const k of KEYS) {
    if (!window[k]) continue;
    try {
      sources.push({ via: `window.${k}`, data: JSON.parse(JSON.stringify(window[k])) });
    } catch {
      sources.push({ via: `window.${k}`, data: null });
    }
  }
  for (const r of window.__bdpHook?.responses || []) {
    try {
      sources.push({ via: r.url, data: JSON.parse(r.text) });
    } catch {
      // respuesta que no es JSON
    }
  }
  return { title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 200), hooked: Boolean(window.__bdpHook), sources };
}

// Corre dentro de la página de UN partido: además de esperar los datos, abre
// cada pestaña de mercados (Goles, Córners, Tarjetas, Jugadores...) para que
// la web descargue todos los mercados del partido.
async function collectEventInPage(waitMs, maxTabs) {
  const KEYS = ['initial_state', '__NEXT_DATA__', '__INITIAL_STATE__', '__NUXT__', '__PRELOADED_STATE__'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const end = Date.now() + waitMs;
  const ready = () => KEYS.some((k) => window[k]) || (window.__bdpHook?.responses?.length || 0) > 0;
  while (Date.now() < end && !ready()) await sleep(400);
  await sleep(1500);
  // Pestañas de grupos de mercados: textos cortos en barras de pestañas.
  const visible = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  const tabs = [...document.querySelectorAll('[role="tab"], [data-qa*="tab"], [data-qa*="market-group"], [class*="tabs"] button, [class*="tab"] a, nav button')]
    .filter((el) => visible(el) && (el.innerText || '').trim().length > 0 && (el.innerText || '').trim().length < 30)
    .slice(0, maxTabs);
  const clicked = [];
  for (const el of tabs) {
    try {
      el.click();
      clicked.push((el.innerText || '').trim());
      await sleep(900);
    } catch {
      // pestaña que no se puede pulsar
    }
  }
  // Mercados plegados: se despliegan para que carguen sus selecciones.
  for (const el of [...document.querySelectorAll('[aria-expanded="false"]')].filter(visible).slice(0, 60)) {
    try {
      el.click();
    } catch {
      // nada
    }
  }
  await sleep(1500);
  const sources = [];
  for (const k of KEYS) {
    if (!window[k]) continue;
    try {
      sources.push({ via: `window.${k}`, data: JSON.parse(JSON.stringify(window[k])) });
    } catch {
      sources.push({ via: `window.${k}`, data: null });
    }
  }
  for (const r of window.__bdpHook?.responses || []) {
    try {
      sources.push({ via: r.url, data: JSON.parse(r.text) });
    } catch {
      // respuesta que no es JSON
    }
  }
  return { title: document.title, url: location.href, tabs: clicked, sources };
}

// Une los mercados de un mismo partido que llegan por varias vías.
function mergeMarkets(lists) {
  const byKey = new Map();
  for (const m of lists.flat()) {
    const key = `${m.name}|${m.selections.map((s) => s.name).join(',')}`;
    if (!byKey.has(key) || byKey.get(key).selections.length < m.selections.length) byKey.set(key, m);
  }
  return [...byKey.values()];
}

// Todos los mercados de varios partidos, abriendo la página de cada uno.
// urls: { clave: url del partido en Betano }. Devuelve { items: { clave: mercados }, notes }.
export async function getEventMarkets({ urls = {}, waitMs = 15000, maxTabs = 25 } = {}) {
  const items = {};
  const notes = [];
  for (const [key, url] of Object.entries(urls)) {
    if (!url || !url.startsWith(BASE)) continue;
    try {
      const found = await runInSiteTab(url, collectEventInPage, [waitMs, maxTabs], { ownOnly: true, navigate: true });
      const events = [];
      for (const src of found?.sources || []) events.push(...findAll(src.data, isEvent));
      if (!events.length) {
        notes.push(`${key}: sin mercados (${found?.title || url})`);
        continue;
      }
      // El partido de la página es el que tiene más mercados (las otras listas son de partidos relacionados).
      // Las respuestas de cada pestaña pueden traer solo { markets } sin id: se suman al partido.
      const byId = new Map();
      const loose = [];
      for (const e of events) {
        if (e.id == null) loose.push(e);
        else byId.set(String(e.id), [...(byId.get(String(e.id)) || []), e]);
      }
      const size = (list) => list.reduce((n, e) => n + e.markets.length, 0);
      const group = [...byId.values()].sort((a, b) => size(b) - size(a))[0] || [];
      items[key] = mergeMarkets([...group, ...loose].map((e) => toOdds(e, url).markets));
      notes.push(`${key}: ${items[key].length} mercados (pestañas: ${(found.tabs || []).join(', ') || 'ninguna'})`);
    } catch (e) {
      notes.push(`${key}: ${e.message}`);
    }
  }
  return { mode: 'tab', items, notes };
}

// Devuelve { via, items } indicando de dónde salieron los datos.
export async function getOdds({ sport = 'football' } = {}) {
  const page = pageFor(sport);
  const attempts = [];
  try {
    const found = await runInSiteTab(page, collectInPage, [20000], { ownOnly: true, navigate: true });
    const events = new Map();
    const vias = [];
    for (const src of found?.sources || []) {
      const list = findAll(src.data, isEvent);
      vias.push(`${src.via} (${list.length} eventos)`);
      for (const e of list) events.set(String(e.id ?? `${e.name}|${e.startTime}`), e);
    }
    if (events.size) return { mode: 'tab', via: vias.filter((v) => !v.endsWith('(0 eventos)')).join(', '), items: [...events.values()].map((e) => toOdds(e, page)), attempts };
    attempts.push({
      via: 'página del deporte',
      error: 'sin eventos con cuotas',
      page: { title: found?.title, url: found?.url, text: found?.text, hooked: found?.hooked },
      sources: vias,
      keys: (found?.sources || []).map((src) => `${src.via}: ${Object.keys(src.data || {}).slice(0, 12).join(', ')}`),
    });
  } catch (e) {
    attempts.push({ via: 'página del deporte', error: e.message, snippet: e.snippet });
  }
  for (const url of apiCandidates(sport)) {
    try {
      const data = await fetchInTab(page, url);
      const events = findAll(data, isEvent);
      if (events.length) return { mode: 'tab', via: url, items: events.map((e) => toOdds(e, page)), attempts };
      attempts.push({ via: url, error: 'sin eventos con cuotas', keys: Object.keys(data || {}).slice(0, 20) });
    } catch (e) {
      attempts.push({ via: url, error: e.message, snippet: e.snippet });
    }
  }
  const err = new Error('No se encontraron cuotas en Betano');
  err.attempts = attempts;
  throw err;
}

export default {
  id: 'betano',
  name: 'Betano',
  role: 'Cuotas (requiere conexión desde Perú)',
  async diagnose() {
    const { mode, via, items, attempts } = await getOdds();
    // Un partido abierto en su página: cuántos mercados trae en total.
    const withUrl = items.find((e) => e.url);
    let event = null;
    if (withUrl) {
      try {
        const r = await getEventMarkets({ urls: { [withUrl.eventId]: withUrl.url } });
        const markets = r.items[withUrl.eventId] || [];
        event = { partido: `${withUrl.home} vs ${withUrl.away}`, mercados: markets.length, nombres: markets.map((m) => m.name).slice(0, 80), notas: r.notes };
      } catch (e) {
        event = { error: e.message };
      }
    }
    return {
      mode,
      count: items.length,
      sample: items.slice(0, 3),
      details: { via, attempts, marketNames: [...new Set(items.flatMap((e) => e.markets.map((m) => m.name)))].slice(0, 30), paginaDelPartido: event },
    };
  },
};
