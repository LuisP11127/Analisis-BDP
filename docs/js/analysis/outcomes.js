// Resultado de una apuesta a partir del registro de un partido. La misma
// función liquida con el partido real (datos de Flashscore) y estima la
// probabilidad con partidos simulados (simulate.js), así el modelo y la
// liquidación siempre coinciden.
//
// Registro de un partido:
//   sport, state ('finalizado' | 'cancelado' | 'aplazado' | ...)
//   per     [[local, visita], ...] marcador de cada periodo (mitades, cuartos,
//           periodos, entradas; en deportes de sets: juegos/puntos de cada set),
//           primero los reglamentarios y luego los de prórroga
//   nReg    cantidad de periodos reglamentarios
//   final   [local, visita] resultado oficial (con prórroga; en sets: sets ganados)
//   ot      true si hubo prórroga / entradas extra / desempate
//   events  [{ k: 'goal'|'card'|'red'|'pen'|'pengoal'|'og', team, min }] (opcional)
//   stats   { córners: { ft: [l, v], h1: [...], h2: [...] }, ... } (opcional)
//   games   tenis: [{ s: set (0..), w: ganador, srv: quien saca }] (opcional)
//   duration { ft: minutos, s1: minutos } (opcional)
import { decodeParts, parseMarketId, SET_SPORTS } from './catalog.js';

// Deportes que se liquidan con el tiempo reglamentario ("partido" = 90 minutos).
const FT_IS_REG = new Set(['football', 'futsal', 'handball', 'rugby', 'waterpolo']);
// Deportes con cuatro cuartos (las mitades son 2 cuartos).
const QUARTERS = new Set(['basketball', 'american-football', 'waterpolo']);
// En estos deportes la segunda mitad incluye la prórroga.
const H2_WITH_OT = new Set(['basketball', 'american-football']);

const sum2 = (list) => list.reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
const num = (x) => (x == null || x === 'X' ? 0 : Number(x));
const pair = (p) => (p ? [num(p[0]), num(p[1])] : null);

// Periodos de un grupo: mitades, periodos reglamentarios, entradas o los dos primeros sets.
function periodsOf(rec, group) {
  const per = rec.per || [];
  if (group === 'halves') {
    const h1 = qty(rec, 'score', 'h1');
    const h2 = qty(rec, 'score', 'h2');
    return h1 && h2 ? [h1, h2] : null;
  }
  if (group === 'sets12') return per.length >= 2 ? [pair(per[0]), pair(per[1])] : null;
  if (group === 'innings') return per.length >= 9 ? per.slice(0, 9).map(pair) : null;
  const n = rec.nReg || per.length;
  return per.length >= n ? per.slice(0, n).map(pair) : null;
}

const setsWon = (per) => per.reduce((acc, p) => (p[0] > p[1] ? [acc[0] + 1, acc[1]] : p[1] > p[0] ? [acc[0], acc[1] + 1] : acc), [0, 0]);

// Cantidad [local, visita] de una estadística en un periodo, o null si no hay datos.
export function qty(rec, stat = 'score', scope = 'ft') {
  const per = rec.per || [];
  const sport = rec.sport;
  const sets = SET_SPORTS.has(sport);
  if (scope.startsWith('m')) return windowQty(rec, stat, scope);
  if (stat === 'score') {
    if (sets) {
      if (scope === 'ft') return rec.final ? pair(rec.final) : per.length ? setsWon(per.map(pair)) : null;
      if (scope === 's1-2') return per.length >= 2 ? setsWon(per.slice(0, 2).map(pair)) : null;
      const s = scope.match(/^s(\d)$/);
      if (s) return per[Number(s[1]) - 1] ? pair(per[Number(s[1]) - 1]) : null;
      return null;
    }
    const n = rec.nReg || per.length;
    if (scope === 'reg') return per.length >= n ? sum2(per.slice(0, n).map(pair)) : null;
    if (scope === 'ft') {
      if (FT_IS_REG.has(sport)) return per.length >= n && n ? sum2(per.slice(0, n).map(pair)) : rec.final ? pair(rec.final) : null;
      return rec.final ? pair(rec.final) : per.length ? sum2(per.map(pair)) : null;
    }
    if (scope === 'h1' || scope === 'h2') {
      if (QUARTERS.has(sport)) {
        if (per.length < 4) return null;
        if (scope === 'h1') return sum2(per.slice(0, 2).map(pair));
        return sum2(per.slice(2, H2_WITH_OT.has(sport) ? per.length : 4).map(pair));
      }
      const i = scope === 'h1' ? 0 : 1;
      return per[i] ? pair(per[i]) : null;
    }
    const p = scope.match(/^[pi](\d)$/);
    if (p) return per[Number(p[1]) - 1] ? pair(per[Number(p[1]) - 1]) : null;
    const inn = scope.match(/^i1-(\d)$/);
    if (inn) return per.length >= Number(inn[1]) ? sum2(per.slice(0, Number(inn[1])).map(pair)) : null;
    return null;
  }
  // Estadísticas que se calculan con el marcador.
  if (stat === 'games' || stat === 'points' || stat === 'legs' || stat === 'rounds') {
    if (scope === 'ft') return per.length ? sum2(per.map(pair)) : null;
    const s = scope.match(/^s(\d)$/);
    if (s) return per[Number(s[1]) - 1] ? pair(per[Number(s[1]) - 1]) : null;
  }
  if (stat === 'tiebreaks' && sport === 'tennis') {
    if (!per.length) return null;
    const n = per.filter((p) => (num(p[0]) === 7 && num(p[1]) === 6) || (num(p[0]) === 6 && num(p[1]) === 7)).length;
    return [n, 0];
  }
  if (sport === 'baseball' && /_inn$|^innings_won$/.test(stat)) {
    const inns = per.slice(0, Math.max(9, per.length)).filter((p) => p && p[0] !== 'X' && p[1] !== 'X').map(pair);
    if (inns.length < 8) return null;
    if (stat === 'scoreless_inn') return [inns.filter((p) => p[0] === 0 && p[1] === 0).length, 0];
    if (stat === 'tied_inn') return [inns.filter((p) => p[0] === p[1]).length, 0];
    if (stat === 'both_scored_inn') return [inns.filter((p) => p[0] > 0 && p[1] > 0).length, 0];
    return [inns.filter((p) => p[0] > p[1]).length, inns.filter((p) => p[1] > p[0]).length];
  }
  if (stat === 'acesdf') {
    const a = qty(rec, 'aces', scope);
    const d = qty(rec, 'df', scope);
    return a && d ? [a[0] + d[0], a[1] + d[1]] : null;
  }
  if (stat === 'duration') {
    const m = rec.duration?.[scope];
    return m == null ? null : [m, 0];
  }
  if (['pens', 'pengoals', 'owngoals'].includes(stat) && rec.events) {
    const kinds = { pens: ['pen', 'pengoal'], pengoals: ['pengoal'], owngoals: ['og'] }[stat];
    return windowCount(rec, kinds, scope === 'h1' ? 0 : scope === 'h2' ? 45 : 0, scope === 'h1' ? 45.99 : Infinity);
  }
  const s = rec.stats?.[stat]?.[scope];
  return s ? pair(s) : null;
}

// Eventos en una ventana de minutos (goles, tarjetas...).
const KIND = { score: ['goal', 'pengoal', 'og'], cards: ['card', 'red'], reds: ['red'], corners: ['corner'] };
function windowCount(rec, kinds, from, to) {
  if (!rec.events) return null;
  const out = [0, 0];
  for (const e of rec.events) if (kinds.includes(e.k) && e.min >= from && e.min < to) out[e.team === 'home' ? 0 : 1]++;
  return out;
}
function windowQty(rec, stat, scope) {
  const m = scope.match(/^m(\d+)-(\d*)$/);
  if (!m) return null;
  const kinds = KIND[stat];
  if (!kinds) return null;
  return windowCount(rec, kinds, Number(m[1]), m[2] === '' ? Infinity : Number(m[2]));
}

// Eventos en orden, para primero/último/carrera. Béisbol: por media entrada.
function sequence(rec, stat, scope) {
  if (rec.sport === 'baseball' && stat === 'score') {
    const out = [];
    (rec.per || []).forEach((p, i) => {
      // Primero batea la visita (parte alta) y luego el local.
      for (let r = 0; r < num(p[1]); r++) out.push({ team: 'away', min: i * 2 });
      for (let r = 0; r < num(p[0]); r++) out.push({ team: 'home', min: i * 2 + 1 });
    });
    return out;
  }
  if (rec.sport === 'tennis' && stat === 'breaks') {
    if (!rec.games) return null;
    return rec.games.filter((g) => g.w !== g.srv).map((g, i) => ({ team: g.w, min: i }));
  }
  const kinds = KIND[stat];
  if (!kinds || !rec.events) return null;
  let list = rec.events.filter((e) => kinds.includes(e.k));
  const w = scope.match(/^m(\d+)-(\d*)$/);
  if (w) list = list.filter((e) => e.min >= Number(w[1]) && (w[2] === '' || e.min < Number(w[2])));
  if (scope === 'h1') list = list.filter((e) => e.min < 46);
  if (scope === 'h2') list = list.filter((e) => e.min >= 45 && e.per !== 0);
  const p = scope.match(/^p(\d)$/);
  if (p) list = list.filter((e) => e.per === Number(p[1]) - 1);
  if (scope === 'reg' && rec.nReg) list = list.filter((e) => e.per == null || e.per < rec.nReg);
  return list.sort((a, b) => a.min - b.min);
}

const result = (cond) => (cond ? 'won' : 'lost');

// Dos medias apuestas (líneas asiáticas .25/.75).
function asian(line, settleAt) {
  const frac = Math.abs(line % 1);
  if (Math.abs(frac - 0.25) > 1e-9 && Math.abs(frac - 0.75) > 1e-9) return settleAt(line);
  const a = settleAt(line - 0.25);
  const b = settleAt(line + 0.25);
  if (a === b) return a;
  const set = new Set([a, b]);
  if (set.has('won') && set.has('void')) return 'half_won';
  if (set.has('lost') && set.has('void')) return 'half_lost';
  return null;
}

function inRange(x, sel) {
  if (sel.endsWith('+')) return x >= Number(sel.slice(0, -1));
  const r = sel.match(/^(\d+)-(\d+)$/);
  if (r) return x >= Number(r[1]) && x <= Number(r[2]);
  return x === Number(sel);
}

function scoreMatches(H, A, s) {
  const [h, a] = s.split('-');
  const ok = (v, t) => (t.endsWith('+') ? v >= Number(t.slice(0, -1)) : v === Number(t));
  return ok(H, h) && ok(A, a);
}

function marginMatches(d, sel) {
  if (sel === 'draw') return d === 0;
  const [side, r] = sel.split(':');
  if (side === 'home' || side === 'away') {
    const m = side === 'home' ? d : -d;
    return m > 0 && inRange(m, r);
  }
  if (side === 'none') return Math.abs(d) < Number(r.replace('+', ''));
  return d !== 0 && inRange(Math.abs(d), r); // any
}

const side3 = (H, A) => (H > A ? 'home' : A > H ? 'away' : 'draw');

// Liquida una selección. Devuelve 'won' | 'lost' | 'void' | 'half_won' |
// 'half_lost', o null si faltan datos (o el partido no terminó).
export function evaluate(market, sel, line, rec) {
  if (!rec) return null;
  // Cancelado o aplazado: nula cuando ya pasó el plazo (rec.voidable).
  if (['cancelado', 'aplazado'].includes(rec.state)) return rec.voidable ? 'void' : null;
  if (rec.state && rec.state !== 'finalizado') return null;
  const spec = typeof market === 'string' ? parseMarketId(market) : market;
  if (!spec) return null;
  return evalSpec(spec, String(sel), line == null || line === '' ? null : Number(line), rec);
}

function evalSpec(spec, sel, line, rec) {
  const { t, stat, scope, team, n } = spec;
  const neg = sel.startsWith('!');
  const s = neg ? sel.slice(1) : sel;
  const flip = (r) => (neg && (r === 'won' || r === 'lost') ? (r === 'won' ? 'lost' : 'won') : r);

  if (t === 'AND' || t === 'OR') {
    const results = decodeParts(s).map((p) => evalSpec(p.spec, p.sel, p.line, rec));
    if (results.some((r) => r == null)) return null;
    if (t === 'AND') {
      if (results.includes('lost')) return flip('lost');
      if (results.every((r) => r === 'won')) return flip('won');
      return neg ? null : 'void';
    }
    if (results.includes('won')) return flip('won');
    if (results.every((r) => r === 'lost')) return flip('lost');
    return neg ? null : 'void';
  }

  const q = () => qty(rec, stat, scope);
  switch (t) {
    case '1X2': {
      const v = q();
      return v && result(side3(v[0], v[1]) === s);
    }
    case 'ML': {
      const v = q();
      if (!v) return null;
      if (v[0] === v[1]) return 'void';
      return result((v[0] > v[1] ? 'home' : 'away') === s);
    }
    case 'DC': {
      const v = q();
      if (!v) return null;
      const r = side3(v[0], v[1]);
      return result({ '1X': r !== 'away', X2: r !== 'home', 12: r !== 'draw' }[s]);
    }
    case 'OU': {
      const v = q();
      if (!v || line == null) return null;
      const total = team === 'home' ? v[0] : team === 'away' ? v[1] : v[0] + v[1];
      return asian(line, (l) => (total === l ? 'void' : result(s === 'over' ? total > l : total < l)));
    }
    case 'OU3': {
      const v = q();
      if (!v || line == null) return null;
      const total = team === 'home' ? v[0] : team === 'away' ? v[1] : v[0] + v[1];
      return result(s === 'exact' ? total === line : s === 'over' ? total > line : total < line);
    }
    case 'HCP': {
      const v = q();
      if (!v || line == null) return null;
      return asian(line, (l) => {
        const m = v[0] - v[1] + l;
        return m === 0 ? 'void' : result(s === 'home' ? m > 0 : m < 0);
      });
    }
    case 'HCP3': {
      const v = q();
      if (!v || line == null) return null;
      return result(side3(v[0] + line, v[1]) === s);
    }
    case 'BTTS': {
      const v = q();
      const k = n || 1;
      return v && result((v[0] >= k && v[1] >= k) === (s === 'yes'));
    }
    case 'OE': {
      const v = q();
      if (!v) return null;
      const total = team === 'home' ? v[0] : team === 'away' ? v[1] : v[0] + v[1];
      return result((total % 2 === 1) === (s === 'odd'));
    }
    case 'CNT': {
      const v = q();
      if (!v) return null;
      const total = team === 'home' ? v[0] : team === 'away' ? v[1] : v[0] + v[1];
      return flip(result(inRange(total, s)));
    }
    case 'CS': {
      const v = q();
      if (!v) return null;
      const [H, A] = v;
      const bang = s.indexOf('!');
      if (bang >= 0) {
        const kind = s.slice(0, bang);
        const listed = s.slice(bang + 1).split(',').filter(Boolean);
        if (listed.some((x) => scoreMatches(H, A, x))) return 'lost';
        if (kind === 'other') return 'won';
        return result(side3(H, A) === kind);
      }
      return result(s.split(',').some((x) => scoreMatches(H, A, x)));
    }
    case 'CSANY': {
      const per = rec.per || [];
      if (!per.length) return null;
      const list = String(n).split(',');
      const any = per.some((p) => list.some((x) => scoreMatches(num(p[0]), num(p[1]), x)));
      return result(any === (s === 'yes'));
    }
    case 'MRG': {
      const v = q();
      return v && flip(result(marginMatches(v[0] - v[1], s)));
    }
    case 'FIRST':
    case 'LAST':
    case 'RACE': {
      const seq = sequence(rec, stat, scope);
      if (!seq) return null;
      let who = 'none';
      if (t === 'FIRST') who = seq[0]?.team || 'none';
      else if (t === 'LAST') who = seq[seq.length - 1]?.team || 'none';
      else {
        const k = n || 1;
        const c = { home: 0, away: 0 };
        for (const e of seq) {
          if (++c[e.team] >= k) {
            who = e.team;
            break;
          }
        }
      }
      // "Primer equipo en anotar - apuesta sin empate": sin goles se anula.
      if (who === 'none' && s !== 'none' && t === 'FIRST' && scope.startsWith('p') && !['home', 'away'].includes(s)) return 'void';
      return result(who === s);
    }
    case 'FGT': {
      const seq = sequence(rec, 'score', 'ft');
      if (!seq) return null;
      const first = seq.find((e) => !team || e.team === team);
      if (s === 'none') return result(!first);
      if (!first) return 'lost';
      const [a, b] = s.split('-');
      return result(first.min >= Number(a) && (b === '' || first.min < Number(b)));
    }
    case 'PMAX': {
      const ps = stat === 'score' || stat === 'games' ? periodsOf(rec, scope) : null;
      if (!ps) return null;
      const totals = ps.map((p) => p[0] + p[1]);
      const max = Math.max(...totals);
      const winners = totals.flatMap((x, i) => (x === max ? [i] : []));
      const codes = scope === 'halves' ? ['h1', 'h2'] : scope === 'sets12' ? ['s1', 's2'] : scope === 'innings' ? ps.map((_, i) => `i${i + 1}`) : ps.map((_, i) => `p${i + 1}`);
      if (winners.length > 1) return result(s === 'tie');
      return result(codes[winners[0]] === s);
    }
    case 'MAXPER': {
      const ps = periodsOf(rec, scope);
      if (!ps) return null;
      const mh = Math.max(...ps.map((p) => p[0]));
      const ma = Math.max(...ps.map((p) => p[1]));
      return result(side3(mh, ma) === s);
    }
    case 'WINALL':
    case 'WINANY': {
      const ps = periodsOf(rec, scope);
      if (!ps) return null;
      const wins = (side) => ps.map((p) => (side === 'home' ? p[0] > p[1] : p[1] > p[0]));
      const all = (side) => wins(side).every(Boolean);
      const any = (side) => wins(side).some(Boolean);
      const f = t === 'WINALL' ? all : any;
      if (team) return result(f(team) === (s === 'yes'));
      return result((f('home') || f('away')) === (s === 'yes'));
    }
    case 'SCOREALL': {
      const ps = periodsOf(rec, scope);
      if (!ps) return null;
      const ok = ps.every((p) => (team === 'home' ? p[0] > 0 : team === 'away' ? p[1] > 0 : p[0] + p[1] > 0));
      return result(ok === (s === 'yes'));
    }
    case 'ALLPER': {
      const ps = periodsOf(rec, scope);
      if (!ps || line == null) return null;
      const ok = ps.every((p) => (n === 'under' ? p[0] + p[1] < line : p[0] + p[1] > line));
      return result(ok === (s === 'yes'));
    }
    case 'CLEAN': {
      const v = qty(rec, 'score', scope === 'reg' ? 'reg' : 'ft');
      if (!v) return null;
      const home = v[0] > v[1] && v[1] === 0;
      const away = v[1] > v[0] && v[0] === 0;
      const ok = team === 'home' ? home : team === 'away' ? away : home || away;
      return result(ok === (s === 'yes'));
    }
    case 'COMEBACK': {
      const v = qty(rec, 'score', 'ft');
      if (!v) return null;
      let trailed = false;
      if (SET_SPORTS.has(rec.sport)) {
        const c = [0, 0];
        for (const p of rec.per || []) {
          if (num(p[0]) > num(p[1])) c[0]++;
          else c[1]++;
          if ((team === 'home' && c[0] < c[1]) || (team === 'away' && c[1] < c[0])) trailed = true;
        }
      } else {
        const seq = sequence(rec, 'score', 'ft');
        if (!seq) return null;
        const c = { home: 0, away: 0 };
        for (const e of seq) {
          c[e.team]++;
          if ((team === 'home' && c.home < c.away) || (team === 'away' && c.away < c.home)) trailed = true;
        }
      }
      const won = team === 'home' ? v[0] > v[1] : v[1] > v[0];
      return result((trailed && won) === (s === 'yes'));
    }
    case 'OT': {
      if (rec.ot == null) return null;
      return result(Boolean(rec.ot) === (s === 'yes'));
    }
    case 'SEQ': {
      const per = rec.per || [];
      if (!per.length) return null;
      return result(per.map((p) => (num(p[0]) > num(p[1]) ? 'h' : 'a')).join('') === s);
    }
    case 'GSEQ': {
      if (!rec.games) return null;
      const set = Number(scope.slice(1)) - 1;
      const games = rec.games.filter((g) => g.s === set);
      if (games.length < n) return 'void';
      const c = [0, 0];
      for (const g of games.slice(0, n)) c[g.w === 'home' ? 0 : 1]++;
      return result(`${c[0]}-${c[1]}` === s);
    }
    case 'SVC1': {
      if (!rec.games) return null;
      const g = rec.games.find((x) => x.srv === team);
      return g ? result(g.w === s) : null;
    }
    default:
      return null;
  }
}

// Ganancia de una apuesta de 1 unidad según su resultado.
export function profitOf(status, odds) {
  return { won: odds - 1, lost: -1, half_won: (odds - 1) / 2, half_lost: -0.5, void: 0 }[status] ?? 0;
}
