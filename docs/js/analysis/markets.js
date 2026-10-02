// Mercados de apuesta en un formato común:
//   { market, sel, line }
//   1X2 (home/draw/away) · ML ganador sin empate (home/away) · DC doble
//   oportunidad (1X/X2/12) · OU más/menos (over/under + línea) · BTTS ambos
//   marcan (yes/no) · HCP hándicap (home/away; line = hándicap del local)
// Aquí se traducen las cuotas de cada casa a ese formato, se calcula la
// probabilidad implícita sin el margen de la casa y se liquidan las apuestas.
import { groupBy, mean, sum } from '../util.js';
import { basicNorm, similarity } from './matching.js';

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
  if (['1X2', 'ML', 'HCP'].includes(market)) return sel === 'home' ? 1 : sel === 'away' ? -1 : 0;
  if (market === 'DC') return sel === '1X' ? 1 : sel === 'X2' ? -1 : 0;
  return 0;
}

export function selectionLabel(c, ev, unit = 'goles') {
  const home = ev.home?.name || 'Local';
  const away = ev.away?.name || 'Visitante';
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

// Marcador que cuenta para la apuesta: en fútbol, los 90 minutos.
function finalScore(result, sport, market) {
  const s = result.score;
  if (!s) return null;
  const regular = (sport === 'football' || sport === 'futsal') && market !== 'ML';
  return regular && s.homeNT != null && s.awayNT != null ? [s.homeNT, s.awayNT] : [s.home, s.away];
}

// Devuelve 'won' | 'lost' | 'void', o null si el partido aún no termina.
export function settle(c, result, sport) {
  if (!result) return null;
  if (['cancelado', 'aplazado'].includes(result.state)) return result.final ? 'void' : null;
  if (result.state !== 'finalizado') return null;
  const sc = finalScore(result, sport, c.market);
  if (!sc || sc[0] == null || sc[1] == null) return null;
  const [H, A] = sc;
  const win = (cond) => (cond ? 'won' : 'lost');
  switch (c.market) {
    case '1X2':
      return win(c.sel === 'home' ? H > A : c.sel === 'away' ? A > H : H === A);
    case 'ML': {
      if (H !== A) return win(c.sel === 'home' ? H > A : A > H);
      if (result.winner === 1 || result.winner === 2) return win((result.winner === 1) === (c.sel === 'home'));
      return 'void';
    }
    case 'DC':
      return win(c.sel === '1X' ? H >= A : c.sel === 'X2' ? A >= H : H !== A);
    case 'OU': {
      const total = H + A;
      if (total === c.line) return 'void';
      return win(c.sel === 'over' ? total > c.line : total < c.line);
    }
    case 'BTTS':
      return win((H > 0 && A > 0) === (c.sel === 'yes'));
    case 'HCP': {
      const m = H - A + c.line;
      if (m === 0) return 'void';
      return win(c.sel === 'home' ? m > 0 : m < 0);
    }
    default:
      return null;
  }
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

// Lado (respecto del partido de Sofascore `ev`) al que se refiere un texto
// de la casa: 'home' | 'away' | 'draw' | null.
function sideFromText(text, other, ev, swapped) {
  const t = basicNorm(text);
  if (/^(x|empate|draw)$/.test(t)) return 'draw';
  if (t === '1') return swapped ? 'away' : 'home';
  if (t === '2') return swapped ? 'home' : 'away';
  const otherHome = swapped ? other.away : other.home;
  const otherAway = swapped ? other.home : other.away;
  const sh = Math.max(similarity(text, ev.home.name), similarity(text, otherHome || ''));
  const sa = Math.max(similarity(text, ev.away.name), similarity(text, otherAway || ''));
  if (Math.max(sh, sa) < 0.5 || sh === sa) return null;
  return sh > sa ? 'home' : 'away';
}

const lastNumber = (s) => {
  const all = [...String(s).matchAll(/[+-]?\d+(?:[.,]\d+)?/g)];
  return all.length ? num(all[all.length - 1][0]) : NaN;
};

// Traduce los mercados de una casa (Apuesta Total o Betano) ya emparejada con
// el partido de Sofascore. `other` = evento de la casa ({ home, away }).
function offersFromBookmaker(source, markets, other, ev, swapped) {
  const out = [];
  const push = (market, sel, price, line = null) => out.push({ source, market, sel, line, price });
  for (const m of markets || []) {
    const name = basicNorm(m.name);
    const type = m.type || '';
    // Mercados parciales, "empate no válido" y cuotas promocionales (SuperCuotas, con límites).
    if (PARTIAL_ES.test(name) || /empate no valido|apuesta sin empate|super ?cuota|supercuota|boost|mejorada/.test(name)) continue;
    const isTeamSpecific = [other.home, other.away, ev.home.name, ev.away.name].some((n) => n && name.includes(basicNorm(n)));
    if (type === 'QA61' || name.includes('doble oportunidad')) {
      for (const s of m.selections) {
        const t = basicNorm(s.name);
        const direct = { '1x': '1X', x1: '1X', x2: 'X2', '2x': 'X2', 12: '12', 21: '12' }[t.replace(/\s/g, '')];
        let sel = direct;
        if (!sel) {
          const hasDraw = /empate|draw/.test(t);
          const parts = t.split(/ o | or | u /).filter((p) => !/empate|draw/.test(p));
          const sides = parts.map((p) => sideFromText(p, other, ev, swapped));
          if (hasDraw) sel = sides[0] === 'home' ? '1X' : sides[0] === 'away' ? 'X2' : null;
          else if (sides.includes('home') && sides.includes('away')) sel = '12';
        } else if (swapped) {
          sel = { '1X': 'X2', X2: '1X', 12: '12' }[sel];
        }
        if (sel) push('DC', sel, s.price);
      }
    } else if (type === 'QA158' || name.includes('ambos equipos') || name.includes('ambos marcan')) {
      if (isTeamSpecific) continue;
      for (const s of m.selections) {
        const t = basicNorm(s.name);
        if (/^(si|yes)\b/.test(t)) push('BTTS', 'yes', s.price);
        else if (/^no\b/.test(t)) push('BTTS', 'no', s.price);
      }
    } else if (/^OU/.test(type) || name.startsWith('total') || name.includes('mas menos')) {
      if (isTeamSpecific) continue;
      for (const s of m.selections) {
        const t = basicNorm(s.name);
        const line = Number.isFinite(lastNumber(s.name)) ? lastNumber(s.name) : lastNumber(m.name);
        if (!Number.isFinite(line)) continue;
        if (/^(mas|over)\b/.test(t)) push('OU', 'over', s.price, line);
        else if (/^(menos|under)\b/.test(t)) push('OU', 'under', s.price, line);
      }
    } else if (/^HC/.test(type) || name.includes('handicap')) {
      for (const s of m.selections) {
        const value = lastNumber(s.name);
        const side = sideFromText(String(s.name).replace(/\(?[+-]?\d+(?:[.,]\d+)?\)?/g, ''), other, ev, swapped);
        if (!Number.isFinite(value) || (side !== 'home' && side !== 'away')) continue;
        push('HCP', side, s.price, side === 'home' ? value : -value);
      }
    } else if (/^ML/.test(type) || /ganador|resultado (del partido|final)|1x2|1 x 2/.test(name)) {
      if (isTeamSpecific) continue;
      const sels = m.selections.map((s) => ({ s, side: sideFromText(s.name, other, ev, swapped) })).filter((x) => x.side);
      const market = sels.some((x) => x.side === 'draw') ? '1X2' : 'ML';
      if (new Set(sels.map((x) => x.side)).size !== sels.length) continue; // nombres ambiguos
      for (const x of sels) push(market, x.side, x.s.price);
    }
  }
  return out;
}

export const offersFromApuestaTotal = (markets, at, ev, swapped = false) => offersFromBookmaker('apuestatotal', markets, at, ev, swapped);
export const offersFromBetano = (markets, b, ev, swapped = false) => offersFromBookmaker('betano', markets, b, ev, swapped);

// Probabilidad implícita de cada selección sin el margen de la casa,
// promediada entre las casas que la ofrecen: Map(clave -> p).
export function marketProbabilities(offers) {
  const acc = new Map();
  for (const list of groupBy(offers, (o) => `${o.source}|${o.market}|${o.line ?? ''}`).values()) {
    const { market, line } = list[0];
    const sels = GROUPS[market];
    if (!sels) continue;
    const price = {};
    for (const o of list) price[o.sel] = Math.max(price[o.sel] || 0, o.price);
    if (!sels.every((s) => price[s] > 1)) continue;
    const inv = sels.map((s) => 1 / price[s]);
    const overround = market === 'DC' ? sum(inv) / 2 : sum(inv);
    if (overround < 0.95 || overround > 1.35) continue; // cuotas incoherentes
    sels.forEach((s, i) => {
      const key = candidateKey(market, s, line);
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(inv[i] / overround);
    });
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
