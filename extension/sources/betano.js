// Betano Perú: cuotas de fútbol. Solo responde a conexiones desde Perú, por
// eso se consulta dentro de una pestaña de betano.pe (tu navegador).
// La estructura exacta no se ha podido verificar desde fuera de Perú: el
// parser busca en el JSON cualquier evento con mercados y selecciones con
// precio, y el diagnóstico informa qué encontró para ajustarlo.
import { fetchInTab, readPageGlobal } from '../lib/net.js';
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

// Devuelve { via, items } indicando de dónde salieron los datos.
export async function getOdds({ sport = 'football' } = {}) {
  const page = pageFor(sport);
  const attempts = [];
  try {
    const state = await readPageGlobal(page, 'initial_state', 20000);
    const events = findAll(state, isEvent);
    if (events.length) return { mode: 'tab', via: 'window.initial_state', items: events.map((e) => toOdds(e, page)), attempts };
    attempts.push({ via: 'window.initial_state', error: 'sin eventos con cuotas', keys: Object.keys(state || {}).slice(0, 20) });
  } catch (e) {
    attempts.push({ via: 'window.initial_state', error: e.message, snippet: e.snippet });
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
