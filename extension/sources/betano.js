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
  await new Promise((r) => setTimeout(r, 3000)); // dar tiempo a que lleguen las cuotas
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
    return {
      mode,
      count: items.length,
      sample: items.slice(0, 3),
      details: { via, attempts, marketNames: [...new Set(items.flatMap((e) => e.markets.map((m) => m.name)))].slice(0, 30) },
    };
  },
};
