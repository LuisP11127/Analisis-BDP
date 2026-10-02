// Mercados de apuesta en un formato común:
//   { market, sel, line }
//   market es el identificador del catálogo (catalog.js): los principales son
//   1X2 (home/draw/away) · ML ganador sin empate (home/away) · DC doble
//   oportunidad (1X/X2/12) · OU más/menos (over/under + línea) · BTTS ambos
//   marcan (yes/no) · HCP hándicap (home/away; line = hándicap del local), y el
//   resto lleva estadística, periodo y equipo: OU.corners@h1:home, CS@s1...
// Aquí se traducen las cuotas de cada casa a ese formato, se calcula la
// probabilidad implícita sin el margen de la casa y se liquidan las apuestas.
import { groupBy, mean, sum } from '../util.js';
import { decodeParts, labelOf, marketId, parseMarket, parseMarketId, swapSelection } from './catalog.js';
import { evaluate } from './outcomes.js';
import { recordFromFlashscore } from './records.js';

export const GROUPS = {
  '1X2': ['home', 'draw', 'away'],
  ML: ['home', 'away'],
  DC: ['1X', 'X2', '12'],
  OU: ['over', 'under'],
  BTTS: ['yes', 'no'],
  HCP: ['home', 'away'],
};

export const candidateKey = (market, sel, line) => `${market}|${sel}|${line ?? ''}`;
export const isHalfLine = (line) => Number.isFinite(line) && Math.abs((Math.abs(line) % 1) - 0.5) < 1e-9;

// Lado al que favorece la selección: +1 local, -1 visitante, 0 neutral.
export function sideOf(market, sel) {
  const t = String(market).split(/[.@:#]/)[0];
  if (['1X2', 'ML', 'HCP', 'HCP3', 'FIRST', 'LAST', 'RACE'].includes(t)) return sel === 'home' ? 1 : sel === 'away' ? -1 : 0;
  if (t === 'DC') return sel === '1X' ? 1 : sel === 'X2' ? -1 : 0;
  return 0;
}

const LEGACY = new Set(['1X2', 'ML', 'DC', 'OU', 'BTTS', 'HCP']);

export function selectionLabel(c, ev, unit = 'goles') {
  const home = ev.home?.name || 'Local';
  const away = ev.away?.name || 'Visitante';
  if (!LEGACY.has(c.market)) return labelOf(c.market, c.sel, c.line, ev.sport, { home, away });
  switch (c.market) {
    case '1X2':
      return c.sel === 'home' ? `Gana ${home}` : c.sel === 'away' ? `Gana ${away}` : 'Empate';
    case 'ML':
      return `Gana ${c.sel === 'home' ? home : away}`;
    case 'DC':
      return { '1X': `${home} o empate`, X2: `Empate o ${away}`, 12: `${home} o ${away} (sin empate)` }[c.sel];
    case 'OU':
      return `${c.sel === 'over' ? 'Más' : 'Menos'} de ${c.line} ${unit}`;
    case 'BTTS':
      return c.sel === 'yes' ? 'Ambos marcan: Sí' : 'Ambos marcan: No';
    case 'HCP': {
      const line = c.sel === 'home' ? c.line : -c.line;
      return `${c.sel === 'home' ? home : away} ${line > 0 ? '+' : ''}${line} (hándicap)`;
    }
    default:
      return `${c.market} ${c.sel}`;
  }
}

// ---- Liquidación ----

// Registro mínimo con el resultado final (cuando no hay detalle del partido).
export function recordFromResult(result, sport) {
  if (!result) return null;
  // Aplazado/cancelado: se anula solo pasado el plazo (result.final === true).
  const voidable = Boolean(result.final === true || result.voidable);
  if (Array.isArray(result.final)) return { sport, ...result };
  if (result.record) return { ...result.record, sport, state: result.state || result.record.state, winner: result.record.winner ?? result.winner, voidable };
  const s = result.score;
  const regular = (sport === 'football' || sport === 'futsal') && s?.homeNT != null && s?.awayNT != null;
  const final = s ? [regular ? s.homeNT : s.home, regular ? s.awayNT : s.away] : undefined;
  // Marcador por periodo del feed del día (Flashscore).
  if (result.per) return { ...recordFromFlashscore({ sport, state: result.state, final: s ? [s.home, s.away] : null, per: result.per }), winner: result.winner, voidable };
  return {
    sport,
    state: result.state,
    final,
    // Ganador cuando el marcador no lo dice (p. ej. tanda de penales).
    winner: result.winner,
    voidable,
  };
}

// Devuelve 'won' | 'lost' | 'void' | 'half_won' | 'half_lost', o null si el
// partido aún no termina o faltan datos para esa apuesta.
export function settle(c, result, sport) {
  const rec = recordFromResult(result, sport);
  if (!rec) return null;
  const status = evaluate(c.market, c.sel, c.line, rec);
  // Ganador sin empate con marcador igualado: decide el ganador oficial (penales, desempate).
  if (status === 'void' && c.market === 'ML' && (rec.winner === 1 || rec.winner === 2)) return (rec.winner === 1) === (c.sel === 'home') ? 'won' : 'lost';
  return status;
}

// ---- Cuotas de cada casa ----

const num = (s) => Number(String(s).replace(',', '.'));

// Mercados parciales (1.ª mitad, sets, córners...) que no se modelan.
const PARTIAL_EN = /\b(1st|2nd|3rd|4th|first|second|third|fourth)\b|half|quarter|period|inning|corner|card|booking|\bsets?\b|\bmaps?\b|frame|\blegs?\b|\bgames\b/i;
const PARTIAL_ES = /\b(1er|1ra|2do|2da|3er|primer|primera|segundo|segunda|tercer|mitad|cuarto|periodo|entrada|corner|corners|tarjeta|tarjetas|set|sets|juego|juegos|mapa|mapas)\b/;

export function offersFromSofascore(markets, ev) {
  const out = [];
  for (const m of markets || []) {
    if (m.live || PARTIAL_EN.test(m.name) || /draw no bet|\bdnb\b/i.test(m.name)) continue;
    const name = m.name.toLowerCase();
    const choices = m.choices.map((c) => ({ n: c.name.toLowerCase(), price: c.price }));
    const names = choices.map((c) => c.n);
    const line = m.group != null && m.group !== '' ? num(m.group) : NaN;
    const push = (market, sel, price, l = null) => out.push({ source: 'sofascore', market, sel, line: l, price });
    if (/double chance/.test(name)) {
      for (const c of choices) {
        const sel = { '1x': '1X', x2: 'X2', 12: '12' }[c.n];
        if (sel) push('DC', sel, c.price);
      }
    } else if (/both teams to score/.test(name)) {
      for (const c of choices) if (c.n === 'yes' || c.n === 'no') push('BTTS', c.n, c.price);
    } else if (Number.isFinite(line) && names.some((n) => n.startsWith('over'))) {
      if (/handicap|spread|team|home|away/.test(name)) continue;
      for (const c of choices) {
        if (c.n.startsWith('over')) push('OU', 'over', c.price, line);
        else if (c.n.startsWith('under')) push('OU', 'under', c.price, line);
      }
    } else if (!Number.isFinite(line) && names.includes('1') && names.includes('2') && !/handicap|spread/.test(name)) {
      const market = names.includes('x') ? '1X2' : 'ML';
      for (const c of choices) {
        const sel = { 1: 'home', x: 'draw', 2: 'away' }[c.n];
        if (sel) push(market, sel, c.price);
      }
    }
  }
  return out.filter((o) => ev.sport !== 'football' || o.market !== 'ML');
}

// Línea que separa los grupos de selecciones de un mismo mercado de la casa
// (p. ej. "Más/Menos 1.5" y "Más/Menos 2.5" vienen juntos pero son apuestas distintas).
function groupLine(o) {
  const spec = o.spec;
  if (['OU', 'OU3', 'HCP', 'HCP3', 'ALLPER'].includes(spec.t)) return `${o.line}`;
  if (spec.t === 'AND' || spec.t === 'OR') {
    const lines = decodeParts(String(o.sel).replace(/^!/, '')).map((p) => (p.line == null ? '' : p.line));
    return lines.filter((x) => x !== '').join(',');
  }
  return '';
}

// Traduce los mercados de una casa (Apuesta Total o Betano) ya emparejada con
// el partido. `other` = evento de la casa ({ home, away }); swapped = la casa
// lista los equipos al revés.
function offersFromBookmaker(source, markets, other, ev, swapped, stats) {
  const out = [];
  for (const m of markets || []) {
    let r;
    try {
      r = parseMarket(m.name, m.selections || [], { sport: ev.sport, home: other.home, away: other.away });
    } catch {
      r = null;
    }
    if (!r) continue;
    if (r.unsupported) {
      if (stats) stats[r.unsupported] = (stats[r.unsupported] || 0) + 1;
      continue;
    }
    if (stats) stats.ok = (stats.ok || 0) + 1;
    for (const o of r.outcomes) {
      const x = swapped ? swapSelection(o.spec, o.sel, o.line) : o;
      const market = marketId(x.spec);
      out.push({ source, market, sel: x.sel, line: x.line ?? null, price: o.price, group: `${source}|${m.name}|${groupLine({ spec: x.spec, sel: x.sel, line: x.line })}` });
    }
  }
  return out;
}

export const offersFromApuestaTotal = (markets, at, ev, swapped = false, stats) => offersFromBookmaker('apuestatotal', markets, at, ev, swapped, stats);
export const offersFromBetano = (markets, b, ev, swapped = false, stats) => offersFromBookmaker('betano', markets, b, ev, swapped, stats);

// Probabilidad implícita de cada selección sin el margen de la casa,
// promediada entre las casas que la ofrecen: Map(clave -> p).
// Se calcula dentro de cada grupo de selecciones excluyentes (un mercado de la
// casa con una misma línea); grupos incompletos o incoherentes se ignoran.
export function marketProbabilities(offers) {
  const acc = new Map();
  const groupKey = (o) => o.group || `${o.source}|${o.market}|${o.line ?? ''}`;
  for (const list of groupBy(offers, groupKey).values()) {
    const spec = parseMarketId(list[0].market);
    if (!spec) continue;
    const best = new Map();
    for (const o of list) {
      const key = candidateKey(o.market, o.sel, o.line);
      if (!best.has(key) || o.price > best.get(key).price) best.set(key, o);
    }
    const items = [...best.values()];
    if (items.length < 2) continue;
    const legacy = GROUPS[spec.t] && !list[0].group;
    if (legacy && !GROUPS[spec.t].every((s) => items.some((o) => o.sel === s))) continue;
    // Selecciones "N+" sin su contraria no forman un grupo completo.
    if (spec.t === 'OU' && !(items.some((o) => o.sel === 'over') && items.some((o) => o.sel === 'under'))) continue;
    if (spec.t === 'OU' && items.length !== 2) continue;
    const inv = items.map((o) => 1 / o.price);
    const covered = spec.t === 'DC' ? 2 : 1; // en doble oportunidad cada resultado está en dos selecciones
    const overround = sum(inv) / covered;
    const multi = items.length > 3;
    if (overround < (multi ? 1.0 : 0.95) || overround > (multi ? 1.6 : 1.35)) continue;
    items.forEach((o, i) => {
      const key = candidateKey(o.market, o.sel, o.line);
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(inv[i] / overround);
    });
  }
  return new Map([...acc].map(([k, ps]) => [k, mean(ps)]));
}

// Probabilidad aproximada cuando el grupo de la casa está incompleto (p. ej.
// solo algunos marcadores exactos): 1/cuota dividida por el margen típico de
// ese tipo de mercado. Es menos fiable que marketProbabilities.
const MANY_WAY = new Set(['CS', 'CSANY', 'CNT', 'MRG', 'FGT', 'AND', 'OR', 'PMAX', 'MAXPER', 'GSEQ', 'SEQ', 'OU3', 'HCP3', 'COURSE']);
export function looseProbabilities(offers) {
  const acc = new Map();
  for (const o of offers) {
    const spec = parseMarketId(o.market);
    if (!spec || !(o.price > 1)) continue;
    const overround = MANY_WAY.has(spec.t) ? 1.22 : spec.t === '1X2' ? 1.08 : 1.06;
    const key = candidateKey(o.market, o.sel, o.line);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(Math.min(0.97, 1 / o.price / overround));
  }
  return new Map([...acc].map(([k, ps]) => [k, mean(ps)]));
}

// Mejor cuota por casa para cada selección: Map(clave -> { casa: cuota }).
export function pricesByKey(offers) {
  const out = new Map();
  for (const o of offers) {
    const key = candidateKey(o.market, o.sel, o.line);
    if (!out.has(key)) out.set(key, {});
    const entry = out.get(key);
    entry[o.source] = Math.max(entry[o.source] || 0, o.price);
  }
  return out;
}
