// Pestaña Apuestas (demo): partidos por empezar con sus cuotas y sus mercados
// agrupados como en la casa de apuestas (paneles con el nombre del mercado y
// pestañas Principales, Goles, Mitades, Córners, Tarjetas...).
//
// Cuotas: las de Apuesta Total que publica GitHub Actions (en cualquier
// dispositivo) y, con la extensión, las de Betano (lista del deporte y, al
// abrir un partido, todos sus mercados).
import * as ext from './ext.js';
import * as provider from './provider.js';
import { STAT_NAME, TYPES, familyOf, labelOf, parseMarketId, scopeLabel } from './analysis/catalog.js';
import { matchEvent } from './analysis/matching.js';
import { offersFromBetano, selectionLabel } from './analysis/markets.js';
import { SPORTS, sportOf } from './sports.js';
import { addDays, limaToday } from './util.js';

export const BOOK_NAME = { betano: 'Betano', apuestatotal: 'Apuesta Total' };
const BETANO_TTL = 5 * 60000;

// Deportes con cuotas hoy o mañana: [{ slug, name, icon, count }].
export async function sportsWithOdds({ force = false } = {}) {
  const idx = await provider.loadIndex({ force });
  const today = limaToday();
  const counts = new Map();
  for (const d of [today, addDays(today, 1)]) for (const [sport, s] of Object.entries(idx?.days?.[d] || {})) counts.set(sport, (counts.get(sport) || 0) + (s.withOdds || 0));
  return SPORTS.filter((s) => counts.get(s.slug) > 0).map((s) => ({ ...s, count: counts.get(s.slug) }));
}

// Partidos de hoy y mañana que aún no empiezan, con cuotas: [{ ev, offers, book, generated }].
export async function loadEvents(sport, { now = Date.now(), force = false } = {}) {
  const today = limaToday();
  const out = [];
  for (const date of [today, addDays(today, 1)]) {
    const day = await provider.loadDay(date, sport, { force }).catch(() => null);
    for (const ev of day?.events || []) {
      if (!(ev.start > now)) continue;
      const offers = (day.offers.get(ev.id) || []).filter((o) => o.price > 1);
      if (offers.length) out.push({ ev, offers, book: 'apuestatotal', generated: day.generated });
    }
  }
  return out.sort((a, b) => a.ev.start - b.ev.start);
}

// Con la extensión: cuotas de Betano para los partidos que también están ahí.
// Devuelve { matched, error }.
const betanoLists = new Map(); // deporte -> { at, items }
export async function addBetano(sport, rows) {
  if (!ext.available() || !rows.length) return { matched: 0 };
  try {
    let entry = betanoLists.get(sport);
    if (!entry || Date.now() - entry.at > BETANO_TTL) {
      entry = { at: Date.now(), items: (await ext.call('betano', 'getOdds', { sport }, { timeout: 90000 })).items || [] };
      betanoLists.set(sport, entry);
    }
    let matched = 0;
    for (const row of rows) {
      const m = matchEvent(row.ev, entry.items, { toleranceMin: sport === 'tennis' ? 90 : 25 });
      if (!m) continue;
      const offers = offersFromBetano(m.item.markets, m.item, row.ev, m.swapped).filter((o) => o.price > 1);
      if (!offers.length) continue;
      Object.assign(row, { offers, book: 'betano', generated: new Date(entry.at).toISOString(), betano: { url: m.item.url, item: m.item, swapped: m.swapped } });
      matched++;
    }
    return { matched };
  } catch (e) {
    return { matched: 0, error: e.message };
  }
}

// Con la extensión: todos los mercados del partido en Betano (abre su página).
export async function betanoAllMarkets(row) {
  if (!ext.available() || !row.betano?.url || row.full) return row;
  const r = await ext.call('betano', 'getEventMarkets', { urls: { [row.ev.id]: row.betano.url } }, { timeout: 240000 });
  const offers = offersFromBetano(r.items?.[row.ev.id] || [], row.betano.item, row.ev, row.betano.swapped).filter((o) => o.price > 1);
  if (offers.length >= row.offers.length) Object.assign(row, { offers, full: true, generated: new Date().toISOString() });
  return row;
}

// ---- Mercados como en la casa ----

const MAIN = new Set(['games', 'sets', 'legs', 'maps', 'rounds', 'frames']);

// Pestaña del mercado.
export function tabOf(market) {
  const fam = familyOf(parseMarketId(market));
  if (fam === 'resultado' || fam === 'ambos' || MAIN.has(fam)) return 'principales';
  if (fam === 'total') return 'totales';
  if (fam === 'handicap') return 'handicaps';
  if (fam === 'periodo') return 'periodos';
  if (fam === 'corners') return 'corners';
  if (fam === 'cards' || fam === 'reds') return 'tarjetas';
  if (fam === 'marcador' || fam === 'margen') return 'marcador';
  if (fam === 'combinado') return 'combinadas';
  if (fam === 'otro') return 'otros';
  return 'estadisticas';
}

const TOTALS = { football: 'Goles', futsal: 'Goles', 'ice-hockey': 'Goles', handball: 'Goles', basketball: 'Puntos', 'american-football': 'Puntos', baseball: 'Carreras', tennis: 'Juegos' };
const PERIODS = { football: 'Mitades', futsal: 'Mitades', handball: 'Mitades', basketball: 'Cuartos', baseball: 'Entradas', tennis: 'Sets', volleyball: 'Sets', 'table-tennis': 'Sets', 'ice-hockey': 'Periodos' };
export const TAB_ORDER = ['principales', 'totales', 'handicaps', 'periodos', 'corners', 'tarjetas', 'estadisticas', 'marcador', 'combinadas', 'otros'];
export function tabName(tab, sport) {
  if (tab === 'totales') return TOTALS[sport] || 'Totales';
  if (tab === 'periodos') return PERIODS[sport] || 'Periodos';
  return { principales: 'Principales', handicaps: 'Hándicaps', corners: 'Córners', tarjetas: 'Tarjetas', estadisticas: 'Estadísticas', marcador: 'Marcador', combinadas: 'Combinadas', otros: 'Otros' }[tab] || tab;
}

const names = (ev) => ({ home: ev.home.name, away: ev.away.name });
const signed = (x) => (x > 0 ? `+${x}` : `${x}`);

// Texto del botón dentro de su mercado ("Más de 2.5", "Empate", "1X"...).
export function shortLabel(o, ev) {
  const spec = parseMarketId(o.market);
  const n = names(ev);
  const s = String(o.sel);
  switch (spec?.t) {
    case '1X2':
    case 'ML':
      return s === 'draw' ? 'Empate' : s === 'home' ? n.home : s === 'away' ? n.away : s;
    case 'DC':
      return s;
    case 'OU':
    case 'OU3':
      return s === 'over' ? `Más de ${o.line}` : s === 'under' ? `Menos de ${o.line}` : `Exacto ${o.line}`;
    case 'BTTS':
      return s === 'yes' ? 'Sí' : 'No';
    case 'HCP':
      return `${s === 'home' ? n.home : n.away} ${signed(s === 'home' ? o.line : -o.line)}`;
    case 'OE':
      return s === 'odd' ? 'Impar' : 'Par';
    default:
      return labelOf(o.market, o.sel, o.line, ev.sport, n);
  }
}

// Texto completo de la selección (boleto y apuestas).
export const fullLabel = (o, ev) => selectionLabel(o, ev, sportOf(ev.sport).unit);

// Nombre del mercado cuando la casa no lo trae ("Más/menos · córners · 1.er tiempo").
export function marketTitle(market, sport) {
  const spec = parseMarketId(market);
  if (!spec) return market;
  const base = { '1X2': 'Resultado final', ML: 'Ganador', DC: 'Doble oportunidad', OU: `Total de ${sportOf(sport).unit}`, BTTS: 'Ambos marcan', HCP: 'Hándicap' }[spec.t] || TYPES[spec.t] || spec.t;
  const stat = spec.stat && spec.stat !== 'score' ? STAT_NAME[spec.stat] || spec.stat : '';
  const team = spec.team === 'home' ? 'local' : spec.team === 'away' ? 'visita' : '';
  return [spec.stat && spec.stat !== 'score' && spec.t === 'OU' ? 'Más/menos' : base, stat, team, scopeLabel(spec.scope, sport)].filter(Boolean).join(' · ');
}

// Paneles de mercados: uno por mercado de la casa, con sus selecciones en filas
// (una fila por línea en los de más/menos y hándicap). Ordenados por pestaña.
export function marketPanels(offers, ev) {
  const panels = new Map();
  for (const o of offers) {
    const name = String(o.group || '').split('|')[1] || marketTitle(o.market, ev.sport);
    const key = `${name}|${o.market}`;
    if (!panels.has(key)) panels.set(key, { key, title: name, market: o.market, tab: tabOf(o.market), offers: [] });
    const p = panels.get(key);
    if (!p.offers.some((x) => x.sel === o.sel && x.line === o.line)) p.offers.push(o);
  }
  const out = [...panels.values()].map((p) => {
    const spec = parseMarketId(p.market);
    p.offers.sort((a, b) => (SEL_ORDER[a.sel] ?? 5) - (SEL_ORDER[b.sel] ?? 5));
    const byLine = ['OU', 'OU3', 'HCP', 'HCP3'].includes(spec?.t) && new Set(p.offers.map((o) => o.line)).size > 1;
    const rows = byLine
      ? [...new Set(p.offers.map((o) => o.line))].sort((a, b) => a - b).map((line) => p.offers.filter((o) => o.line === line))
      : [p.offers];
    return { ...p, rows };
  });
  return out.sort((a, b) => TAB_ORDER.indexOf(a.tab) - TAB_ORDER.indexOf(b.tab) || marketRank(a.market) - marketRank(b.market));
}

// Orden como en la casa: 1-X-2, más/menos, sí/no; resultado final antes que el resto.
const SEL_ORDER = { home: 0, draw: 1, away: 2, over: 0, exact: 1, under: 2, yes: 0, no: 1, '1X': 0, 12: 1, X2: 2, odd: 0, even: 1 };
const TYPE_ORDER = ['1X2', 'DC', 'ML', 'BTTS', 'OU', 'OU3', 'HCP', 'HCP3'];
function marketRank(market) {
  const spec = parseMarketId(market);
  const t = TYPE_ORDER.indexOf(spec?.t);
  return (t < 0 ? TYPE_ORDER.length : t) + (spec?.team ? 0.5 : 0);
}

// Cuotas de la lista de partidos: 1-X-2 (o 1-2 sin empate).
export function mainOdds(offers) {
  const find = (market, sel) => offers.find((o) => o.market === market && o.sel === sel && o.line == null);
  const x12 = ['home', 'draw', 'away'].map((s) => find('1X2', s));
  if (x12.every(Boolean)) return x12;
  const ml = ['home', 'away'].map((s) => find('ML', s));
  return ml.every(Boolean) ? ml : null;
}

// Selección para el boleto (lo que se guarda en la apuesta).
export function selectionOf(row, o, marketName = '') {
  const { ev } = row;
  return {
    eventId: ev.id,
    sport: ev.sport,
    start: ev.start,
    match: `${ev.home.name} vs ${ev.away.name}`,
    league: ev.tournament?.name || '',
    url: ev.url || null,
    market: o.market,
    sel: o.sel,
    line: o.line ?? null,
    label: fullLabel(o, ev),
    marketName,
    price: o.price,
    source: o.source,
  };
}
