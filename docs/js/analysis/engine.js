// Análisis de los partidos seleccionados:
//  1) Sofascore: forma, últimos partidos, H2H, bajas, votos y cuotas de referencia.
//  2) Cuotas de Apuesta Total y Betano (emparejando cada partido).
//  3) xG de Understat (fútbol, 5 grandes ligas).
//  4) Probabilidad del modelo + probabilidad del mercado -> probabilidad base.
//  5) Red neuronal (opcional): corrige la probabilidad base.
//  6) Picks por nivel de confianza y combinadas.
import * as ext from '../ext.js';
import { sportOf } from '../sports.js';
import { clamp, groupBy, limaDateOf, logit, sigmoid } from '../util.js';
import { buildFeatures, FEATURE_VERSION } from './features.js';
import {
  candidateKey,
  marketProbabilities,
  offersFromApuestaTotal,
  offersFromBetano,
  offersFromSofascore,
  pricesByKey,
  selectionLabel,
} from './markets.js';
import { bestByName, matchEvent } from './matching.js';
import { allowedMarkets, predict } from './models.js';
import { buildCombos, DEFAULT_SETTINGS, selectPicks } from './picks.js';

// Ligas de Understat según el id de torneo de Sofascore.
const UNDERSTAT_LEAGUES = { 17: 'EPL', 8: 'La_liga', 35: 'Bundesliga', 23: 'Serie_A', 34: 'Ligue_1' };
const DETAILS_PER_CALL = 5;
const BETTABLE = ['apuestatotal', 'betano'];

// Probabilidad base: mezcla (en escala logit) del modelo y del mercado. El
// mercado pesa más cuando el modelo tiene pocos datos o es un deporte sin
// modelo propio.
export function blend(pModel, pMarket, quality, kind) {
  if (pModel == null && pMarket == null) return null;
  if (pMarket == null) return sigmoid(0.85 * logit(pModel)); // sin mercado: moderar el modelo
  if (pModel == null) return pMarket;
  const wMarket = kind === 'tennis' || kind === 'generic' ? 0.7 : quality >= 0.6 ? 0.55 : 0.75;
  return sigmoid(wMarket * logit(pMarket) + (1 - wMarket) * logit(pModel));
}

function bestPrice(prices) {
  let best = null;
  for (const source of BETTABLE) if (prices[source] > 1 && (!best || prices[source] > best.price)) best = { source, price: prices[source] };
  if (!best && prices.sofascore > 1) best = { source: 'sofascore', price: prices.sofascore, reference: true };
  return best;
}

function formText(f) {
  if (!f?.last5?.length) return '';
  return f.last5.map((r) => ({ W: 'G', D: 'E', L: 'P' })[r]).join('');
}

// Datos que explican el pick (se muestran en la tarjeta).
function factorsFor(ev, d, model, c) {
  const out = [];
  const fh = model?.form?.home;
  const fa = model?.form?.away;
  if (fh && fa) out.push(`Forma: ${ev.home.name} ${formText(fh)} · ${ev.away.name} ${formText(fa)}`);
  const e = model?.expected;
  if (e && model.kind === 'goals') out.push(`Esperado: ${e.home.toFixed(2)} – ${e.away.toFixed(2)}${e.xg ? ' (con xG)' : ''}`);
  if (e && model.kind === 'points') out.push(`Esperado: ${e.home.toFixed(0)} – ${e.away.toFixed(0)} (total ${e.total.toFixed(1)})`);
  if (d?.h2h && d.h2h.homeWins + d.h2h.draws + d.h2h.awayWins > 0) out.push(`H2H: ${d.h2h.homeWins}-${d.h2h.draws}-${d.h2h.awayWins}`);
  if (ev.home.ranking && ev.away.ranking) out.push(`Ranking: ${ev.home.ranking} vs ${ev.away.ranking}`);
  const miss = d?.missing;
  if (miss && (miss.home.length || miss.away.length)) out.push(`Bajas: ${miss.home.length} local · ${miss.away.length} visita`);
  if (c.pMarket != null) out.push(`Mercado: ${Math.round(c.pMarket * 100)}%`);
  if (c.pModel != null) out.push(`Modelo: ${Math.round(c.pModel * 100)}%`);
  return out;
}

async function sofascoreDetails(events, sources, progress) {
  const details = {};
  let failed = 0;
  for (let i = 0; i < events.length; i += DETAILS_PER_CALL) {
    progress(`Sofascore: estadísticas ${Math.min(i + DETAILS_PER_CALL, events.length)} de ${events.length}`, (0.6 * i) / events.length);
    const chunk = events.slice(i, i + DETAILS_PER_CALL).map((e) => ({
      id: e.id,
      sport: e.sport,
      homeId: e.home.id,
      awayId: e.away.id,
      homeSlug: e.home.slug || null,
      awaySlug: e.away.slug || null,
      start: e.start,
      url: e.url || null,
    }));
    try {
      const r = await ext.call('sofascore', 'getEventDetails', { events: chunk }, { timeout: 400000 });
      Object.assign(details, r.items);
      failed += r.failed || 0;
      sources.sofascore = { ok: true, mode: r.mode, failed };
    } catch (e) {
      sources.sofascore = { ok: false, error: e.message };
    }
  }
  return details;
}

async function bookmakerOffers(events, sources, progress) {
  const offers = new Map(); // id de Sofascore -> ofertas
  const add = (id, list) => offers.set(id, [...(offers.get(id) || []), ...list]);
  const bySport = groupBy(events, (e) => e.sport);

  progress('Apuesta Total: cuotas', 0.65);
  let atMatched = 0;
  for (const [sport, evs] of bySport) {
    try {
      const from = Math.min(...evs.map((e) => e.start)) - 3 * 3600000;
      const to = Math.max(...evs.map((e) => e.start)) + 3 * 3600000;
      const list = (await ext.call('apuestatotal', 'getEventList', { sport, from, to })).items;
      const pairs = new Map();
      for (const ev of evs) {
        const m = matchEvent(ev, list, { toleranceMin: sport === 'tennis' ? 90 : 25 });
        if (m) pairs.set(m.item.eventId, { ev, m });
      }
      if (!pairs.size) continue;
      const { items } = await ext.call('apuestatotal', 'getMarkets', { eventIds: [...pairs.keys()], sport }, { timeout: 120000 });
      for (const [atId, { ev, m }] of pairs) {
        const list2 = offersFromApuestaTotal(items[atId] || [], m.item, ev, m.swapped);
        if (list2.length) atMatched++;
        add(ev.id, list2);
      }
      sources.apuestatotal = { ok: true, matched: atMatched };
    } catch (e) {
      sources.apuestatotal = { ok: false, error: e.message };
    }
  }
  sources.apuestatotal ||= { ok: true, matched: 0 };

  progress('Betano: cuotas', 0.75);
  let bMatched = 0;
  for (const [sport, evs] of bySport) {
    try {
      const list = (await ext.call('betano', 'getOdds', { sport }, { timeout: 90000 })).items;
      for (const ev of evs) {
        const m = matchEvent(ev, list, { toleranceMin: sport === 'tennis' ? 90 : 25 });
        if (!m) continue;
        const list2 = offersFromBetano(m.item.markets, m.item, ev, m.swapped);
        if (list2.length) bMatched++;
        add(ev.id, list2);
      }
      sources.betano = { ok: true, matched: bMatched };
    } catch (e) {
      sources.betano = { ok: false, error: e.message };
    }
  }
  return offers;
}

async function understatXg(events, sources, progress) {
  const out = new Map();
  const byLeague = groupBy(
    events.filter((e) => e.sport === 'football' && UNDERSTAT_LEAGUES[e.tournament?.id]),
    (e) => UNDERSTAT_LEAGUES[e.tournament.id],
  );
  if (!byLeague.size) return out;
  progress('Understat: goles esperados (xG)', 0.82);
  for (const [league, evs] of byLeague) {
    try {
      const { items } = await ext.call('understat', 'getTeamStrength', { league });
      for (const ev of evs) {
        const home = bestByName(ev.home.name, items);
        const away = bestByName(ev.away.name, items);
        if (home && away) out.set(ev.id, { home, away });
      }
      sources.understat = { ok: true, matched: out.size };
    } catch (e) {
      sources.understat = { ok: false, error: e.message };
    }
  }
  return out;
}

const halfLines = (offers, market) => [...new Set(offers.filter((o) => o.market === market && o.line != null).map((o) => o.line))];

// Candidatos (todas las selecciones con probabilidad) de un partido.
export function analyzeEvent(ev, d, offers, { xg, network = null, method = 'estadistico' } = {}) {
  const cfg = sportOf(ev.sport);
  const allowed = allowedMarkets(cfg);
  const usable = offers.filter((o) => allowed.has(o.market));
  const model = predict(ev, d, cfg, { lines: { OU: halfLines(usable, 'OU'), HCP: halfLines(usable, 'HCP') }, xg });
  const pMarket = marketProbabilities(usable);
  const prices = pricesByKey(usable);
  const keys = new Map();
  for (const c of model?.candidates || []) if (allowed.has(c.market)) keys.set(candidateKey(c.market, c.sel, c.line), { ...c, pModel: c.p });
  for (const key of pMarket.keys()) {
    if (keys.has(key)) continue;
    const [market, sel, line] = key.split('|');
    keys.set(key, { market, sel, line: line === '' ? null : Number(line), pModel: null });
  }
  const out = [];
  for (const [key, c] of keys) {
    const pm = pMarket.get(key) ?? null;
    const pBase = blend(c.pModel, pm, model?.quality ?? 0, model?.kind || cfg.model);
    const priceMap = prices.get(key) || {};
    const best = bestPrice(priceMap);
    if (pBase == null || !best) continue; // sin cuota no se puede apostar ni aprender
    const cand = { key, eventId: ev.id, sport: ev.sport, start: ev.start, market: c.market, sel: c.sel, line: c.line, pModel: c.pModel, pMarket: pm, pBase, prices: priceMap, best };
    cand.x = buildFeatures({ ...cand, price: best.price }, { sport: ev.sport, cfg, model, details: d });
    cand.p = method === 'red_neuronal' && network ? network.predict(cand.x, pBase) : pBase;
    cand.p = clamp(cand.p, 0.001, 0.999);
    cand.label = selectionLabel(cand, ev, cfg.unit);
    cand.factors = factorsFor(ev, d, model, cand);
    cand.ev = cand.p * best.price - 1;
    out.push(cand);
  }
  return { model, candidates: out };
}

const summaryOf = (ev) => ({
  id: ev.id,
  sport: ev.sport,
  start: ev.start,
  league: ev.tournament?.name || '',
  country: ev.category?.name || '',
  home: ev.home.name,
  away: ev.away.name,
  url: ev.url || null,
});

// events: partidos de Sofascore seleccionados. Devuelve el análisis completo.
export async function analyze(events, { method = 'estadistico', settings = DEFAULT_SETTINGS, network = null, onProgress = () => {} } = {}) {
  const sources = {};
  const pending = events.filter((e) => e.state === 'pendiente');
  const details = await sofascoreDetails(pending, sources, onProgress);
  const offers = await bookmakerOffers(pending, sources, onProgress);
  const xg = await understatXg(pending, sources, onProgress);

  onProgress('Calculando probabilidades', 0.9);
  const candidates = [];
  const eventInfo = {};
  for (const ev of pending) {
    const sofaOffers = offersFromSofascore(details[ev.id]?.odds, ev);
    const all = [...sofaOffers, ...(offers.get(ev.id) || [])];
    const { model, candidates: list } = analyzeEvent(ev, details[ev.id], all, { xg: xg.get(ev.id), network, method });
    candidates.push(...list);
    eventInfo[ev.id] = { ...summaryOf(ev), hasModel: Boolean(model), quality: model?.quality ?? 0, bookmakers: [...new Set(all.map((o) => o.source))] };
  }

  const picks = selectPicks(candidates, settings);
  const combos = buildCombos(candidates, settings);
  const created = new Date().toISOString();
  const date = pending.length ? limaDateOf(Math.min(...pending.map((e) => e.start))) : null;
  onProgress('Listo', 1);
  return {
    id: `${method === 'red_neuronal' ? 'rn' : 'est'}-${created.replace(/\D/g, '').slice(0, 14)}`,
    method,
    created,
    date,
    settings: { ...settings },
    network: network ? { trained: network.trained, samples: network.meta?.samples || 0 } : null,
    sources,
    events: eventInfo,
    candidates,
    picks,
    combos,
    skipped: events.length - pending.length,
    featureVersion: FEATURE_VERSION,
  };
}
