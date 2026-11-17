// Selector: de los picks de un análisis, elige los que caen en un mercado de
// una liga que viene acertando mucho (se apuestan tal cual) o muy poco (se
// apuesta la inversa). Las cifras salen de "Por deporte" del Historial, de
// cada método por separado y con todos los días desde SPORT_FROM.
//
// Dos secciones, cada una con su seguimiento por día:
//   general: tipo de mercado de la liga (Hándicap, Más/menos...)
//   lado:    lado de ese mercado (Más / Menos, Local / Visitante...)
import { familyOf, parseMarketId } from './analysis/catalog.js';
import { candidateKey, selectionLabel } from './analysis/markets.js';
import { leagueKey } from './history.js';

export const SEL_GENERAL = 'selector';
export const SEL_LADO = 'selector_lado';
export const SELECTOR_METHODS = [SEL_GENERAL, SEL_LADO];
export const SOURCE_METHODS = ['estadistico', 'red_neuronal'];

// Reglas: mínimo de apuestas resueltas y porcentajes (redondeados como se ven en la tabla).
export const RULES = { minResolved: 10, direct: 67, inverse: 33 };
// Los picks con más de este valor esperado llevan la etiqueta "de valor" y no entran.
export const VALUE_EV = 0.01;

// ---- Lados ----

export const SIDE_NAME = {
  over: 'Más',
  under: 'Menos',
  home: 'Local',
  draw: 'Empate',
  away: 'Visitante',
  '1X': '1X (local o empate)',
  X2: 'X2 (empate o visitante)',
  12: '12 (sin empate)',
  yes: 'Sí',
  no: 'No',
  odd: 'Impar',
  even: 'Par',
  none: 'Ninguno',
  exact: 'Exacto',
  tie: 'Empate',
  otro: 'Otros',
};
const SIDE_ORDER = Object.keys(SIDE_NAME);
export const sideRank = (k) => (SIDE_ORDER.includes(k) ? SIDE_ORDER.indexOf(k) : SIDE_ORDER.length);

// Lado de una selección: over, under, home, draw, away, 1X, X2, 12, yes, no...
// Las selecciones compuestas (marcadores, combinados) van a "otro".
export function sideKey(sel) {
  const s = String(sel ?? '');
  return Object.hasOwn(SIDE_NAME, s) && s !== 'otro' ? s : 'otro';
}

// La apuesta contraria: más ↔ menos, sí ↔ no, local ↔ visitante, par ↔ impar.
// En doble oportunidad, el resultado que queda fuera (1X → gana el visitante);
// del empate, "12". Misma línea: en el hándicap la línea es siempre la del local.
const SWAP = { over: 'under', under: 'over', yes: 'no', no: 'yes', home: 'away', away: 'home', odd: 'even', even: 'odd' };
const DC_OUT = { '1X': 'away', X2: 'home', 12: 'draw' };
const withType = (market, t) => String(market).replace(/^[A-Z0-9]+/, t);

export function inverseOf(market, sel, line) {
  const spec = parseMarketId(market);
  if (!spec) return null;
  const s = String(sel);
  if (SWAP[s]) return { market, sel: SWAP[s], line };
  if (spec.t === 'DC' && DC_OUT[s]) return { market: withType(market, '1X2'), sel: DC_OUT[s], line: null };
  if (s === 'draw' && spec.t === '1X2') return { market: withType(market, 'DC'), sel: '12', line: null };
  return null;
}

// ---- Reglas ----

const pct = (st) => (st && st.won + st.lost ? Math.round((st.won / (st.won + st.lost)) * 100) : null);

// 'directa' | 'inversa' | null con las cifras de un mercado (o lado).
export function ruleFor(st) {
  if (!st || st.won + st.lost < RULES.minResolved) return null;
  const p = pct(st);
  if (p >= RULES.direct) return 'directa';
  if (p <= RULES.inverse) return 'inversa';
  return null;
}

const statsInfo = (st) => ({ hit: pct(st), n: st.won + st.lost });

// Mercados y lados que hoy cumplen la regla, por método (para mostrarlos).
export function qualifying(methodTotals) {
  const out = [];
  for (const method of SOURCE_METHODS) {
    const m = methodTotals?.[method];
    if (!m) continue;
    for (const [sport, leagues] of Object.entries(m.bySportLeagueMarket || {}))
      for (const [league, fams] of Object.entries(leagues))
        for (const [family, st] of Object.entries(fams)) {
          const rule = ruleFor(st);
          if (rule) out.push({ section: SEL_GENERAL, method, sport, league, family, side: null, rule, ...statsInfo(st) });
          for (const [side, sst] of Object.entries(m.bySportLeagueSide?.[sport]?.[league]?.[family] || {})) {
            const r2 = ruleFor(sst);
            if (r2) out.push({ section: SEL_LADO, method, sport, league, family, side, rule: r2, ...statsInfo(sst) });
          }
        }
  }
  return out;
}

// ---- Selector de un análisis ----

// Picks que pueden entrar: los de los tres niveles, sin los de valor (las
// combinadas no se miran).
export const eligible = (p) => !(p.ev > VALUE_EV);

const names = (ev) => ({ home: { name: ev?.home || 'Local' }, away: { name: ev?.away || 'Visitante' }, sport: ev?.sport });

// La apuesta a hacer: la del pick o su inversa (con su cuota si el análisis la tiene).
function betOf(p, rule, result) {
  if (rule === 'directa') return { key: p.key, market: p.market, sel: p.sel, line: p.line, label: p.label, odds: p.best?.price ?? p.odds ?? null, source: p.best?.source ?? p.source ?? null };
  const inv = inverseOf(p.market, p.sel, p.line);
  if (!inv) return null;
  const key = candidateKey(inv.market, inv.sel, inv.line);
  const c = (result.candidates || []).find((x) => x.eventId === p.eventId && x.key === key);
  const ev = result.events?.[p.eventId];
  return {
    key,
    ...inv,
    label: c?.label || selectionLabel({ ...inv }, names(ev)),
    odds: c?.best?.price ?? null,
    source: c?.best?.source ?? null,
  };
}

// results: { estadistico, red_neuronal } (los del análisis recién hecho).
// methodTotals: totales de "Por deporte" por método. Devuelve las dos secciones;
// si los dos métodos dan la misma apuesta, sale una vez con los dos.
export function buildSelector(results, methodTotals) {
  const out = { [SEL_GENERAL]: new Map(), [SEL_LADO]: new Map() };
  let base = null;
  const used = [];
  for (const method of SOURCE_METHODS) {
    const result = results?.[method];
    if (!result) continue;
    base ||= result;
    used.push(method);
    const m = methodTotals?.[method];
    for (const p of result.picks || []) {
      if (!eligible(p)) continue;
      const ev = result.events?.[p.eventId];
      const sport = p.sport || 'otro';
      const league = leagueKey(ev);
      const family = familyOf(parseMarketId(p.market));
      const side = sideKey(p.sel);
      const sections = [
        [SEL_GENERAL, m?.bySportLeagueMarket?.[sport]?.[league]?.[family]],
        [SEL_LADO, m?.bySportLeagueSide?.[sport]?.[league]?.[family]?.[side]],
      ];
      for (const [section, st] of sections) {
        const rule = ruleFor(st);
        if (!rule) continue;
        const bet = betOf(p, rule, result);
        if (!bet) continue;
        const id = `${p.eventId}|${bet.key}`;
        const prev = out[section].get(id);
        const why = { method, hit: pct(st), n: st.won + st.lost };
        if (prev) {
          if (!prev.methods.includes(method)) prev.methods.push(method);
          prev.rules.push(why);
          continue;
        }
        out[section].set(id, {
          eventId: p.eventId,
          sport,
          start: p.start,
          match: ev ? `${ev.home} vs ${ev.away}` : '',
          url: ev?.url || null,
          ...(ev?.fsId ? { fsId: ev.fsId } : {}),
          league,
          family,
          side,
          inverse: rule === 'inversa',
          // El pick tal como lo dio el análisis.
          orig: { key: p.key, market: p.market, sel: p.sel, line: p.line, label: p.label, odds: p.best?.price ?? p.odds ?? null, level: p.level, p: p.p },
          ...bet,
          level: p.level,
          p: rule === 'inversa' ? 1 - p.p : p.p,
          methods: [method],
          rules: [why],
          status: 'pending',
          score: null,
        });
      }
    }
  }
  const sorted = (map) => [...map.values()].sort((a, b) => a.start - b.start || a.match.localeCompare(b.match));
  return base ? { created: base.created, date: base.date, run: base.run, methods: used, events: base.events, [SEL_GENERAL]: sorted(out[SEL_GENERAL]), [SEL_LADO]: sorted(out[SEL_LADO]) } : null;
}

// Las dos secciones como análisis del día (para guardarlas en el historial).
export function selectorAnalyses(sel) {
  if (!sel) return [];
  const stamp = sel.created.replace(/\D/g, '').slice(0, 14);
  return SELECTOR_METHODS.filter((method) => sel[method].length).map((method) => {
    const used = new Set(sel[method].map((p) => String(p.eventId)));
    return {
      id: `${method === SEL_GENERAL ? 'sel' : 'sel-lado'}-${stamp}`,
      method,
      created: sel.created,
      run: sel.run,
      date: sel.date,
      rules: { ...RULES },
      events: Object.fromEntries(Object.entries(sel.events || {}).filter(([id]) => used.has(String(id)))),
      picks: sel[method],
      combos: [],
    };
  });
}
