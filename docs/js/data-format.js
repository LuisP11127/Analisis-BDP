// Formato compacto de los datos publicados en data/fuente (los escribe
// scripts/collect-data.mjs y los lee la página). Compacto para que carguen
// rápido en el celular; aquí se convierten al formato normal de la página.
import { compactRecord, expandRecord } from './analysis/records.js';
import { compactTeamStats, expandTeamStats } from './analysis/teamstats.js';

export const FORMAT_VERSION = 2; // 2: grupos de cuotas, estadísticas de equipo y registros
const LAST_MATCHES = 10;

const fsUrl = (id) => `https://www.flashscore.pe/partido/${String(id).replace(/^fs:/, '')}/`;

export function compactEvent(e) {
  return {
    id: e.id,
    sp: e.sport,
    st: Math.round(e.start / 1000),
    t: [e.tournament.id, e.tournament.name, e.tournament.priority || 0],
    c: [e.category.name, e.category.alpha2 || null],
    h: [e.home.id, e.home.name],
    a: [e.away.id, e.away.name],
    s: e.state,
    ...(e.score ? { sc: [e.score.home, e.score.away] } : {}),
  };
}

const team = ([id, name]) => ({ id, name, short: name, slug: null, alpha2: null, ranking: null, national: false });

export function expandEvent(c) {
  return {
    id: c.id,
    source: 'flashscore',
    sport: c.sp,
    start: c.st * 1000,
    tournament: { id: c.t[0], name: c.t[1], priority: c.t[2] },
    category: { id: null, name: c.c[0], alpha2: c.c[1] },
    home: team(c.h),
    away: team(c.a),
    state: c.s,
    statusText: '',
    score: c.sc ? { home: c.sc[0], away: c.sc[1], homeNT: null, awayNT: null } : null,
    winner: null,
    url: fsUrl(c.id),
  };
}

const compactMatches = (list = []) => list.slice(0, LAST_MATCHES).map((m) => [Math.round(m.start / 1000), m.home ? 1 : 0, m.gf, m.ga, m.r]);
const expandMatches = (list = []) => list.map(([st, home, gf, ga, r]) => ({ start: st * 1000, home: Boolean(home), gf, ga, r }));

export function compactDetails(d) {
  const out = { h: compactMatches(d.lastHome), a: compactMatches(d.lastAway), d: d.h2h ? [d.h2h.homeWins, d.h2h.draws, d.h2h.awayWins] : null };
  if (d.teamStats) out.ts = { h: compactTeamStats(d.teamStats.home), a: compactTeamStats(d.teamStats.away) };
  return out;
}

export function expandDetails(c) {
  return {
    form: null,
    missing: null,
    odds: null,
    votes: null,
    h2h: c.d ? { homeWins: c.d[0], draws: c.d[1], awayWins: c.d[2] } : null,
    lastHome: expandMatches(c.h),
    lastAway: expandMatches(c.a),
    teamStats: c.ts ? { home: expandTeamStats(c.ts.h) || {}, away: expandTeamStats(c.ts.a) || {} } : null,
  };
}

// Cuotas: { g: [grupos], o: [[mercado, selección, línea, cuota, grupo]] }. El
// grupo (mercado de la casa con su línea) sirve para quitar el margen.
export function compactOffers(list) {
  const groups = [];
  const index = new Map();
  const gi = (g) => {
    if (g == null) return null;
    if (!index.has(g)) index.set(g, groups.push(g.replace(/^apuestatotal\|/, '')) - 1);
    return index.get(g);
  };
  return { g: groups, o: list.map((o) => [o.market, o.sel, o.line, o.price, gi(o.group)]) };
}
export function expandOffers(c = []) {
  // Versión 1: lista sin grupos.
  if (Array.isArray(c)) return c.map(([market, sel, line, price]) => ({ source: 'apuestatotal', market, sel, line, price }));
  return (c.o || []).map(([market, sel, line, price, g]) => ({ source: 'apuestatotal', market, sel, line, price, ...(g != null ? { group: `apuestatotal|${c.g[g]}` } : {}) }));
}

const r3 = (x) => Math.round(x * 1000) / 1000;
export const compactXg = (x) => ({ h: [r3(x.home.xgFor), r3(x.home.xgAgainst)], a: [r3(x.away.xgFor), r3(x.away.xgAgainst)] });
export const expandXg = (c) => ({ home: { xgFor: c.h[0], xgAgainst: c.h[1] }, away: { xgFor: c.a[0], xgAgainst: c.a[1] } });

// Archivo de un día y un deporte.
export function compactDay({ date, sport, generated, events, offers = {}, details = {}, xg = {} }) {
  const map = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
  return { v: FORMAT_VERSION, date, sport, generated, events: events.map(compactEvent), offers: map(offers, compactOffers), details: map(details, compactDetails), xg: map(xg, compactXg) };
}

export function expandDay(c) {
  const map = (obj, fn) => new Map(Object.entries(obj || {}).map(([k, v]) => [k, fn(v)]));
  return {
    date: c.date,
    sport: c.sport,
    generated: c.generated,
    events: (c.events || []).map(expandEvent),
    offers: map(c.offers, expandOffers),
    details: map(c.details, expandDetails),
    xg: map(c.xg, expandXg),
  };
}

// Resultados: { id: [estado, local, visita, periodos?, registro?] }. Los
// periodos salen del feed del día; el registro completo (incidencias y
// estadísticas) solo para los partidos analizados.
export function compactResult(r, { per = null, record = null } = {}) {
  const out = [r.state, r.score?.home ?? null, r.score?.away ?? null];
  if (per || record) out.push(per || null);
  if (record) out.push(compactRecord(record));
  return out;
}
export function expandResult([state, home, away, per, record], sport = null) {
  const out = { state, score: home != null && away != null ? { home, away, homeNT: null, awayNT: null } : null, winner: null };
  if (per) out.per = per;
  if (record) out.record = expandRecord(record, sport, state);
  return out;
}
