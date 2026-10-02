// Simulación de partidos (Monte Carlo). Con los parámetros de cada equipo
// (goles/puntos esperados y estadísticas promedio de Sofascore y Flashscore)
// se generan miles de partidos completos (marcador por periodo, minutos de los
// goles, tarjetas, córners, juegos de tenis...) y se liquida cada selección en
// cada uno con el mismo código que liquida las apuestas reales (outcomes.js).
// La probabilidad de una selección es la fracción de partidos en que gana.
import { clamp, rng } from '../util.js';
import { decodeParts, parseMarketId } from './catalog.js';
import { evaluate } from './outcomes.js';

// ---- Números aleatorios ----

export function poisson(lambda, r) {
  if (!(lambda > 0)) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(r)));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

export function normal(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function gamma(shape, r) {
  if (shape < 1) return gamma(shape + 1, r) * r() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal(r);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// Binomial negativa (más dispersa que Poisson): córners, tarjetas, tiros...
export function negBin(mean, k, r) {
  if (!(mean > 0)) return 0;
  if (!k || k > 200) return poisson(mean, r);
  return poisson(gamma(k, r) * (mean / k), r);
}

const binom = (n, p, r) => {
  let k = 0;
  for (let i = 0; i < n; i++) if (r() < p) k++;
  return k;
};

// Minuto dentro de un periodo, con algo más de goles al final (densidad 0.85 + 0.3x).
function minuteFraction(r) {
  const u = r();
  // inversa de F(x) = 0.85x + 0.15x²
  return (-0.85 + Math.sqrt(0.7225 + 0.6 * u)) / 0.3;
}

// ---- Constantes por deporte (promedios generales; los de cada equipo los reemplazan) ----

// Fútbol: parte del primer tiempo, dispersión y promedio por equipo de cada estadística.
export const FOOTBALL_STATS = {
  corners: { mean: 4.9, k: 8, h1: 0.47 },
  cards: { mean: 2.1, k: 6, h1: 0.4 },
  shots: { mean: 12, k: 12, h1: 0.47 },
  shots_on: { mean: 4.2, k: 10, h1: 0.47 },
  fouls: { mean: 11.5, k: 25, h1: 0.48 },
  offsides: { mean: 1.9, k: 5, h1: 0.5 },
  throwins: { mean: 20, k: 30, h1: 0.5 },
  goalkicks: { mean: 8, k: 15, h1: 0.5 },
  passes: { mean: 420, k: 0, h1: 0.5, sd: 0.2 },
  tackles: { mean: 16, k: 20, h1: 0.5 },
  woodwork: { mean: 0.3, k: 0, h1: 0.5 },
};
export const HOCKEY_STATS = { sog: { mean: 29, k: 25 }, pim: { mean: 8, k: 3 } };
export const BASKET_STATS = { threes: 11, twos: 24, ftm: 16, reb: 42, oreb: 10, dreb: 32, ast: 23, tov: 13 };
export const AF_STATS = { pass_yds: 220, rush_yds: 115 };

// ---- Generadores de partidos ----

function addStat(stats, name, side, scope, v) {
  const s = (stats[name] ||= {});
  const p = (s[scope] ||= [0, 0]);
  p[side] += v;
}

function football(P, r) {
  const per = [
    [0, 0],
    [0, 0],
  ];
  const events = [];
  const stats = {};
  const teams = [
    ['home', P.lh, 0],
    ['away', P.la, 1],
  ];
  for (const [team, lam, side] of teams) {
    for (let half = 0; half < 2; half++) {
      const g = poisson(lam * (half ? 1 - P.h1 : P.h1), r);
      for (let i = 0; i < g; i++) {
        const u = r();
        const k = u < P.pPen ? 'pengoal' : u < P.pPen + P.pOg ? 'og' : 'goal';
        events.push({ k, team, min: half * 45 + minuteFraction(r) * 45, per: half });
        per[half][side]++;
      }
    }
    // Penales fallados (los convertidos están entre los goles).
    const missed = poisson(P.penMiss, r);
    for (let i = 0; i < missed; i++) events.push({ k: 'pen', team, min: r() * 90 });
    // Estadísticas por mitad.
    for (const [name, def] of Object.entries(P.stats)) {
      const mean = side === 0 ? def.h : def.a;
      for (let half = 0; half < 2; half++) {
        const m = mean * (half ? 1 - def.h1 : def.h1);
        const v = def.sd ? Math.max(0, Math.round(m + m * def.sd * normal(r))) : negBin(m, def.k, r);
        addStat(stats, name, side, half ? 'h2' : 'h1', v);
        addStat(stats, name, side, 'ft', v);
        // Córners y tarjetas con minuto (para "primero", "último" y ventanas de tiempo).
        if (name === 'corners' || name === 'cards') for (let i = 0; i < v; i++) events.push({ k: name === 'cards' ? 'card' : 'corner', team, min: half * 45 + r() * 45 });
      }
    }
    const reds = poisson(P.reds[side], r);
    for (let i = 0; i < reds; i++) {
      const min = r() * 90;
      events.push({ k: 'red', team, min });
      addStat(stats, 'reds', side, min < 45 ? 'h1' : 'h2', 1);
      addStat(stats, 'reds', side, 'ft', 1);
      addStat(stats, 'cards', side, min < 45 ? 'h1' : 'h2', 1);
      addStat(stats, 'cards', side, 'ft', 1);
    }
  }
  events.sort((a, b) => a.min - b.min);
  const final = [per[0][0] + per[1][0], per[0][1] + per[1][1]];
  return { sport: P.sport, state: 'finalizado', per, nReg: 2, final, ot: false, events, stats };
}

// Hockey, balonmano, futsal, waterpolo, floorball: goles por periodo (+ prórroga).
function goalsByPeriod(P, r) {
  const nReg = P.shares.length;
  const per = P.shares.map(() => [0, 0]);
  const events = [];
  const stats = {};
  const len = P.periodMinutes;
  for (const [team, lam, side] of [
    ['home', P.lh, 0],
    ['away', P.la, 1],
  ]) {
    P.shares.forEach((share, i) => {
      const g = poisson(lam * share, r);
      for (let j = 0; j < g; j++) {
        const u = r();
        events.push({ k: 'goal', team, min: i * len + r() * len, per: i, pp: u < P.pPP, sh: u >= P.pPP && u < P.pPP + P.pSH });
        per[i][side]++;
      }
    });
    for (const [name, def] of Object.entries(P.stats || {})) addStat(stats, name, side, 'ft', negBin(side ? def.a : def.h, def.k, r));
  }
  let final = [per.reduce((s, p) => s + p[0], 0), per.reduce((s, p) => s + p[1], 0)];
  let ot = false;
  if (P.overtime && final[0] === final[1]) {
    ot = true;
    const pHome = P.lh / (P.lh + P.la);
    const otPer = [0, 0];
    if (r() < P.otGoal) {
      const side = r() < pHome ? 0 : 1;
      otPer[side] = 1;
      events.push({ k: 'goal', team: side ? 'away' : 'home', min: nReg * len + r() * 5, per: nReg });
    } else {
      // Tanda de penales: un gol más para el ganador en el resultado final.
      const side = r() < 0.5 + (pHome - 0.5) * 0.3 ? 0 : 1;
      final = side ? [final[0], final[1] + 1] : [final[0] + 1, final[1]];
    }
    per.push(otPer);
    final = [final[0] + otPer[0], final[1] + otPer[1]];
  }
  if (P.sport === 'ice-hockey') {
    const goals = events.filter((e) => e.k === 'goal');
    for (const side of [0, 1]) {
      const team = side ? 'away' : 'home';
      addStat(stats, 'ppg', side, 'ft', goals.filter((e) => e.team === team && e.pp).length);
      addStat(stats, 'shg', side, 'ft', goals.filter((e) => e.team === team && e.sh).length);
      addStat(stats, 'eng', side, 'ft', poisson(P.eng[side], r));
    }
  }
  events.sort((a, b) => a.min - b.min);
  return { sport: P.sport, state: 'finalizado', per, nReg, final, ot, events, stats };
}

// Básquet: puntos por cuarto con un ritmo común a ambos equipos.
function basketball(P, r) {
  const per = [];
  const quarter = () => {
    const c = P.sdPace * normal(r);
    return [Math.max(0, Math.round(P.qh + c + P.sdTeam * normal(r))), Math.max(0, Math.round(P.qa + c + P.sdTeam * normal(r)))];
  };
  for (let i = 0; i < 4; i++) per.push(quarter());
  let tot = per.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
  let ot = false;
  while (tot[0] === tot[1]) {
    ot = true;
    const c = P.sdPace * 0.6 * normal(r);
    const q = [Math.max(0, Math.round(P.qh * P.otShare + c + P.sdTeam * 0.6 * normal(r))), Math.max(0, Math.round(P.qa * P.otShare + c + P.sdTeam * 0.6 * normal(r)))];
    per.push(q);
    tot = [tot[0] + q[0], tot[1] + q[1]];
  }
  const stats = {};
  for (const [name, def] of Object.entries(P.stats || {})) {
    for (const side of [0, 1]) {
      const m = side ? def.a : def.h;
      addStat(stats, name, side, 'ft', Math.max(0, Math.round(m + 0.18 * m * normal(r))));
    }
  }
  return { sport: P.sport, state: 'finalizado', per, nReg: 4, final: tot, ot, stats };
}

// Fútbol americano: touchdowns y field goals por cuarto.
function americanFootball(P, r) {
  const per = [];
  const stats = {};
  const tds = [0, 0];
  const events = [];
  P.shares.forEach((share, q) => {
    const pts = [0, 0];
    for (const side of [0, 1]) {
      const team = side ? 'away' : 'home';
      const td = poisson(P.td[side] * share, r);
      const fg = poisson(P.fg[side] * share, r);
      for (let i = 0; i < td; i++) {
        const u = r();
        pts[side] += u < 0.92 ? 7 : u < 0.97 ? 6 : 8;
        events.push({ k: 'goal', team, min: q * 15 + r() * 15, per: q });
      }
      for (let i = 0; i < fg; i++) {
        pts[side] += 3;
        events.push({ k: 'goal', team, min: q * 15 + r() * 15, per: q });
      }
      if (r() < 0.006) pts[side] += 2;
      tds[side] += td;
    }
    per.push(pts);
  });
  let final = per.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
  let ot = false;
  if (final[0] === final[1]) {
    ot = true;
    const side = r() < P.td[0] / (P.td[0] + P.td[1]) ? 0 : 1;
    const add = r() < 0.6 ? 3 : 6;
    const otp = side ? [0, add] : [add, 0];
    per.push(otp);
    final = [final[0] + otp[0], final[1] + otp[1]];
    events.push({ k: 'goal', team: side ? 'away' : 'home', min: 60 + r() * 10, per: 4 });
    if (add === 6) tds[side]++;
  }
  for (const side of [0, 1]) {
    const rush = binom(tds[side], 0.42, r);
    addStat(stats, 'tds', side, 'ft', tds[side]);
    addStat(stats, 'rush_tds', side, 'ft', rush);
    addStat(stats, 'pass_tds', side, 'ft', tds[side] - rush);
    const py = Math.max(0, Math.round(P.passYds[side] * (1 + 0.28 * normal(r))));
    const ry = Math.max(0, Math.round(P.rushYds[side] * (1 + 0.35 * normal(r))));
    addStat(stats, 'pass_yds', side, 'ft', py);
    addStat(stats, 'rush_yds', side, 'ft', ry);
    addStat(stats, 'total_yds', side, 'ft', py + ry);
  }
  events.sort((a, b) => a.min - b.min);
  return { sport: P.sport, state: 'finalizado', per, nReg: 4, final, ot, events, stats };
}

// Rugby: tries, conversiones y penales por tiempo.
function rugby(P, r) {
  const per = [];
  for (let h = 0; h < 2; h++) {
    const pts = [0, 0];
    for (const side of [0, 1]) {
      const tries = poisson(P.tries[side] / 2, r);
      pts[side] += tries * 5 + binom(tries, 0.72, r) * 2 + poisson(P.pens[side] / 2, r) * 3;
    }
    per.push(pts);
  }
  const final = [per[0][0] + per[1][0], per[0][1] + per[1][1]];
  return { sport: P.sport, state: 'finalizado', per, nReg: 2, final, ot: false };
}

// Béisbol: carreras por media entrada; el local no batea el 9.º si va ganando.
function baseball(P, r) {
  const per = [];
  let tot = [0, 0];
  const runs = (side, inning) => negBin((side ? P.la : P.lh) / 9 * (inning === 0 ? 1.12 : inning >= 9 ? 1.6 : 0.985), 1.3, r);
  for (let i = 0; ; i++) {
    const away = runs(1, i);
    tot[1] += away;
    if (i >= 8 && tot[0] > tot[1]) {
      per.push([i === 8 ? 'X' : 0, away]);
      break;
    }
    const home = runs(0, i);
    tot[0] += home;
    per.push([home, away]);
    if (i >= 8 && tot[0] !== tot[1]) break;
    if (i > 20) {
      tot[0] += 1;
      break;
    }
  }
  const stats = {};
  for (const side of [0, 1]) addStat(stats, 'hits', side, 'ft', negBin(P.hits[side], 12, r));
  return { sport: P.sport, state: 'finalizado', per, nReg: 9, final: tot, ot: per.length > 9, stats };
}

// Tenis: punto a punto con la probabilidad de ganar el punto al saque.
function tennis(P, r) {
  const per = [];
  const games = [];
  const aces = [0, 0];
  const df = [0, 0];
  const breaks = [0, 0];
  const setAces = [];
  const setDf = [];
  let points = 0;
  let server = r() < 0.5 ? 0 : 1;
  const won = [0, 0];
  const need = Math.ceil(P.bestOf / 2);
  let s = 0;
  while (won[0] < need && won[1] < need) {
    const g = [0, 0];
    const sa = [0, 0];
    const sd = [0, 0];
    for (;;) {
      if (g[0] === 6 && g[1] === 6) {
        // Desempate a 7 puntos.
        const tp = [0, 0];
        let srv = server;
        let k = 0;
        while (!((tp[0] >= 7 || tp[1] >= 7) && Math.abs(tp[0] - tp[1]) >= 2)) {
          const p = srv === 0 ? P.ph : P.pa;
          const w = r() < p ? srv : 1 - srv;
          tp[w]++;
          points++;
          k++;
          if (k % 2 === 1) srv = 1 - srv;
        }
        const w = tp[0] > tp[1] ? 0 : 1;
        g[w]++;
        games.push({ s, w: w ? 'away' : 'home', srv: server ? 'away' : 'home', tb: true });
        server = 1 - server;
        break;
      }
      // Juego normal.
      const p = server === 0 ? P.ph : P.pa;
      let a = 0;
      let b = 0;
      while (!((a >= 4 || b >= 4) && Math.abs(a - b) >= 2)) {
        if (r() < p) a++;
        else b++;
        points++;
      }
      const w = a > b ? server : 1 - server;
      if (w !== server) breaks[w]++;
      g[w]++;
      sa[server] += poisson(P.aces[server], r);
      sd[server] += poisson(P.df[server], r);
      games.push({ s, w: w ? 'away' : 'home', srv: server ? 'away' : 'home' });
      server = 1 - server;
      if ((g[0] >= 6 || g[1] >= 6) && Math.abs(g[0] - g[1]) >= 2) break;
      if (g[0] === 7 || g[1] === 7) break;
    }
    per.push(g);
    won[g[0] > g[1] ? 0 : 1]++;
    aces[0] += sa[0];
    aces[1] += sa[1];
    df[0] += sd[0];
    df[1] += sd[1];
    setAces.push(sa);
    setDf.push(sd);
    s++;
  }
  const stats = { aces: { ft: aces }, df: { ft: df }, breaks: { ft: breaks } };
  setAces.forEach((v, i) => (stats.aces[`s${i + 1}`] = v));
  setDf.forEach((v, i) => (stats.df[`s${i + 1}`] = v));
  return {
    sport: 'tennis',
    state: 'finalizado',
    per,
    nReg: per.length,
    final: won,
    ot: false,
    games,
    stats,
    duration: { ft: Math.round(points * P.minPerPoint) },
  };
}

// Vóley, tenis de mesa, bádminton: sets por puntos (rally).
function rallySets(P, r) {
  const per = [];
  const won = [0, 0];
  const need = Math.ceil(P.bestOf / 2);
  while (won[0] < need && won[1] < need) {
    const last = won[0] === need - 1 && won[1] === need - 1;
    const target = last && P.lastTo ? P.lastTo : P.to;
    const pts = [0, 0];
    while (!((pts[0] >= target || pts[1] >= target) && Math.abs(pts[0] - pts[1]) >= 2) && !(P.cap && (pts[0] === P.cap || pts[1] === P.cap))) {
      pts[r() < P.q ? 0 : 1]++;
    }
    per.push(pts);
    won[pts[0] > pts[1] ? 0 : 1]++;
  }
  return { sport: P.sport, state: 'finalizado', per, nReg: per.length, final: won, ot: false };
}

// Dardos: legs por set (o solo legs) y 180s por leg.
function darts(P, r) {
  const per = [];
  const won = [0, 0];
  const s180 = [0, 0];
  const need = P.sets ? Math.ceil(P.bestOf / 2) : 1;
  let legsTotal = 0;
  while (won[0] < need && won[1] < need) {
    const legs = [0, 0];
    const target = P.sets ? 3 : Math.ceil(P.bestOfLegs / 2);
    while (legs[0] < target && legs[1] < target) {
      legs[r() < P.leg ? 0 : 1]++;
      legsTotal++;
      s180[0] += poisson(P.r180[0], r);
      s180[1] += poisson(P.r180[1], r);
    }
    per.push(legs);
    won[legs[0] > legs[1] ? 0 : 1]++;
  }
  return { sport: 'darts', state: 'finalizado', per, nReg: per.length, final: P.sets ? won : per[0], ot: false, stats: { '180s': { ft: s180 } }, legsTotal };
}

// Esports: mapas (y rondas en CS).
function esports(P, r) {
  const per = [];
  const won = [0, 0];
  const need = Math.ceil(P.bestOf / 2);
  while (won[0] < need && won[1] < need) {
    if (P.rounds) {
      const rs = [0, 0];
      while (!(rs[0] === 13 || rs[1] === 13)) {
        rs[r() < P.round ? 0 : 1]++;
        if (rs[0] === 12 && rs[1] === 12) {
          // Prórroga: bloques de 6 rondas, gana el primero a 4.
          for (;;) {
            const b = [0, 0];
            while (b[0] < 4 && b[1] < 4 && b[0] + b[1] < 6) b[r() < P.round ? 0 : 1]++;
            rs[0] += b[0];
            rs[1] += b[1];
            if (b[0] !== b[1]) break;
          }
          break;
        }
      }
      per.push(rs);
      won[rs[0] > rs[1] ? 0 : 1]++;
    } else {
      const w = r() < P.map ? 0 : 1;
      per.push(w ? [0, 1] : [1, 0]);
      won[w]++;
    }
  }
  return { sport: 'esports', state: 'finalizado', per, nReg: per.length, final: won, ot: false };
}

const GENERATORS = {
  football,
  futsal: goalsByPeriod,
  handball: goalsByPeriod,
  waterpolo: goalsByPeriod,
  floorball: goalsByPeriod,
  'ice-hockey': goalsByPeriod,
  bandy: goalsByPeriod,
  basketball,
  'american-football': americanFootball,
  'aussie-rules': basketball,
  rugby,
  baseball,
  tennis,
  volleyball: rallySets,
  'beach-volley': rallySets,
  'table-tennis': rallySets,
  badminton: rallySets,
  darts,
  esports,
};

export const canSimulate = (sport) => Boolean(GENERATORS[sport]);

// ---- Calibración: probabilidad de ganar un set/partido según la de cada punto ----

// Probabilidad de ganar un set a `to` puntos (por 2) ganando cada punto con q.
function setProb(q, to, cap = 0) {
  const memo = new Map();
  const f = (a, b) => {
    if (cap && a === cap) return 1;
    if (cap && b === cap) return 0;
    if (a >= to && a - b >= 2) return 1;
    if (b >= to && b - a >= 2) return 0;
    if (a >= to - 1 && b >= to - 1 && a === b && !cap) return (q * q) / (q * q + (1 - q) * (1 - q));
    const key = a * 100 + b;
    if (memo.has(key)) return memo.get(key);
    const v = q * f(a + 1, b) + (1 - q) * f(a, b + 1);
    memo.set(key, v);
    return v;
  };
  return f(0, 0);
}

// Probabilidad de ganar al mejor de `bestOf` ganando cada set con s (y el último con sLast).
function matchProb(s, bestOf, sLast = s) {
  const need = Math.ceil(bestOf / 2);
  const f = (a, b) => {
    if (a === need) return 1;
    if (b === need) return 0;
    const p = a === need - 1 && b === need - 1 ? sLast : s;
    return p * f(a + 1, b) + (1 - p) * f(a, b + 1);
  };
  return f(0, 0);
}

// Busca x en [lo, hi] con f(x) = target (f creciente).
function solve(f, target, lo = 0.01, hi = 0.99) {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Probabilidad de ganar un juego al saque (fórmula cerrada) y el partido de tenis (aprox. sin desempates).
const gameProb = (p) => {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * ((p * p) / (1 - 2 * p * q));
};

// ---- Parámetros de la simulación a partir del modelo y los datos de cada equipo ----

const avg = (x, y) => (x + y) / 2;

// Media del equipo para una estadística: lo que hace él y lo que le permite el rival.
function teamMean(stats, name, side, fallback) {
  const own = stats?.[side === 0 ? 'home' : 'away']?.[name];
  const opp = stats?.[side === 0 ? 'away' : 'home']?.[name];
  const f = own?.for ?? null;
  const a = opp?.against ?? null;
  if (f != null && a != null) return avg(f, a);
  return f ?? a ?? fallback;
}

// Parámetros de simulación de un partido. model: salida de models.predict.
// teamStats: { home: { corners: { for, against }, ... }, away: {...} } (Flashscore/Sofascore).
// winProb: probabilidad de que gane el local (para deportes de sets).
export function simParams(ev, cfg, model, { teamStats = null, winProb = null, format = {} } = {}) {
  const sport = ev.sport;
  const e = model?.expected;
  if (sport === 'football' || sport === 'futsal') {
    if (!e) return null;
    const stats = {};
    for (const [name, def] of Object.entries(sport === 'football' ? FOOTBALL_STATS : {})) {
      stats[name] = { ...def, h: teamMean(teamStats, name, 0, def.mean), a: teamMean(teamStats, name, 1, def.mean) };
    }
    if (sport === 'futsal') return { sport, lh: e.home, la: e.away, shares: [0.47, 0.53], periodMinutes: 20, pPP: 0, pSH: 0, overtime: false };
    return {
      sport,
      lh: e.home,
      la: e.away,
      h1: 0.45,
      pPen: 0.085,
      pOg: 0.03,
      penMiss: 0.025,
      reds: [teamMean(teamStats, 'reds', 0, 0.065), teamMean(teamStats, 'reds', 1, 0.065)],
      stats,
    };
  }
  if (['ice-hockey', 'handball', 'waterpolo', 'floorball', 'bandy'].includes(sport)) {
    if (!e) return null;
    const P = {
      sport,
      lh: e.home,
      la: e.away,
      shares: { 'ice-hockey': [0.31, 0.34, 0.35], floorball: [0.32, 0.33, 0.35], waterpolo: [0.25, 0.25, 0.25, 0.25] }[sport] || [0.48, 0.52],
      periodMinutes: { 'ice-hockey': 20, floorball: 20, waterpolo: 8 }[sport] || 30,
      overtime: sport === 'ice-hockey' || sport === 'floorball',
      otGoal: 0.6,
      pPP: sport === 'ice-hockey' ? 0.21 : 0,
      pSH: sport === 'ice-hockey' ? 0.03 : 0,
      eng: [0.17, 0.17],
    };
    if (sport === 'ice-hockey') {
      P.stats = {};
      for (const [name, def] of Object.entries(HOCKEY_STATS)) P.stats[name] = { k: def.k, h: teamMean(teamStats, name, 0, def.mean), a: teamMean(teamStats, name, 1, def.mean) };
    }
    return P;
  }
  if (sport === 'basketball' || sport === 'aussie-rules') {
    if (!e) return null;
    const sdTeam = e.sdMargin / Math.sqrt(8);
    const sdPace = Math.sqrt(Math.max(0, e.sdTotal ** 2 - e.sdMargin ** 2) / 16);
    const stats = {};
    if (sport === 'basketball') for (const [name, mean] of Object.entries(BASKET_STATS)) stats[name] = { h: teamMean(teamStats, name, 0, mean), a: teamMean(teamStats, name, 1, mean) };
    return { sport, qh: e.home / 4, qa: e.away / 4, sdTeam, sdPace, otShare: 5 / 12, stats };
  }
  if (sport === 'american-football') {
    if (!e) return null;
    const td = (pts) => pts / (6.94 + 3 * 0.65);
    return {
      sport,
      shares: [0.22, 0.3, 0.2, 0.28],
      td: [td(e.home), td(e.away)],
      fg: [td(e.home) * 0.65, td(e.away) * 0.65],
      passYds: [teamMean(teamStats, 'pass_yds', 0, AF_STATS.pass_yds), teamMean(teamStats, 'pass_yds', 1, AF_STATS.pass_yds)],
      rushYds: [teamMean(teamStats, 'rush_yds', 0, AF_STATS.rush_yds), teamMean(teamStats, 'rush_yds', 1, AF_STATS.rush_yds)],
    };
  }
  if (sport === 'rugby') {
    if (!e) return null;
    return { sport, tries: [(0.65 * e.home) / 6.44, (0.65 * e.away) / 6.44], pens: [(0.35 * e.home) / 3, (0.35 * e.away) / 3] };
  }
  if (sport === 'baseball') {
    if (!e) return null;
    return { sport, lh: e.home, la: e.away, hits: [teamMean(teamStats, 'hits', 0, 8.4), teamMean(teamStats, 'hits', 1, 8.4)] };
  }
  if (winProb == null) return null;
  const P = clamp(winProb, 0.02, 0.98);
  if (sport === 'tennis') {
    const bestOf = format.bestOf || 3;
    const base = format.women ? 0.56 : 0.63;
    const sv = (side) => teamStats?.[side]?.serve?.for;
    const rt = (side) => teamStats?.[side]?.serve?.against;
    // Con estadísticas de saque y resto de Flashscore; si no, se calibra con la probabilidad de ganar.
    let ph = sv('home') != null && rt('away') != null ? avg(sv('home'), rt('away')) : null;
    let pa = sv('away') != null && rt('home') != null ? avg(sv('away'), rt('home')) : null;
    if (ph == null || pa == null) {
      const d = solve((x) => matchProb(setFromGames(gameProb(base + x / 2), gameProb(base - x / 2)), bestOf), P, -0.3, 0.3);
      ph = base + d / 2;
      pa = base - d / 2;
    }
    const perGame = (side, name, fallback) => teamStats?.[side]?.[name]?.for ?? fallback;
    return {
      sport,
      bestOf,
      ph: clamp(ph, 0.35, 0.85),
      pa: clamp(pa, 0.35, 0.85),
      aces: [perGame('home', 'aces_pg', format.women ? 0.25 : 0.55), perGame('away', 'aces_pg', format.women ? 0.25 : 0.55)],
      df: [perGame('home', 'df_pg', 0.3), perGame('away', 'df_pg', 0.3)],
      minPerPoint: 0.63,
    };
  }
  if (['volleyball', 'beach-volley', 'table-tennis', 'badminton'].includes(sport)) {
    const fmt = {
      volleyball: { to: 25, lastTo: 15, bestOf: 5 },
      'beach-volley': { to: 21, lastTo: 15, bestOf: 3 },
      'table-tennis': { to: 11, bestOf: format.bestOf || 5 },
      badminton: { to: 21, cap: 30, bestOf: 3 },
    }[sport];
    const q = solve((x) => matchProb(setProb(x, fmt.to, fmt.cap), fmt.bestOf, setProb(x, fmt.lastTo || fmt.to, fmt.cap)), P, 0.3, 0.7);
    return { sport, ...fmt, q };
  }
  if (sport === 'darts') {
    const sets = format.sets ?? true;
    const bestOf = format.bestOf || 5;
    const bestOfLegs = format.bestOfLegs || 11;
    const leg = sets ? solve((x) => matchProb(matchProb(x, 5), bestOf), P, 0.2, 0.8) : solve((x) => matchProb(x, bestOfLegs), P, 0.2, 0.8);
    return { sport, sets, bestOf, bestOfLegs, leg, r180: [teamMean(teamStats, '180s_pl', 0, 0.28), teamMean(teamStats, '180s_pl', 1, 0.28)] };
  }
  if (sport === 'esports') {
    const bestOf = format.bestOf || 3;
    const map = solve((x) => matchProb(x, bestOf), P, 0.05, 0.95);
    const rounds = Boolean(format.rounds);
    const round = rounds ? solve((x) => setProb(x, 13), map, 0.3, 0.7) : null;
    return { sport, bestOf, map, rounds, round };
  }
  return null;
}

// Probabilidad de ganar un set de tenis (aprox.) con la de ganar cada juego al saque.
function setFromGames(gh, ga) {
  const memo = new Map();
  const f = (a, b, srv) => {
    if (a >= 6 && a - b >= 2) return 1;
    if (b >= 6 && b - a >= 2) return 0;
    if (a === 7 || b === 7) return a > b ? 1 : 0;
    if (a === 6 && b === 6) return 0.5 + (gh - ga) / 2;
    const key = `${a},${b},${srv}`;
    if (memo.has(key)) return memo.get(key);
    const p = srv === 0 ? gh : 1 - ga;
    const v = p * f(a + 1, b, 1 - srv) + (1 - p) * f(a, b + 1, 1 - srv);
    memo.set(key, v);
    return v;
  };
  return f(0, 0, 0);
}

// ---- Estimación ----

// En hockey, básquet y fútbol americano los empates en el tiempo reglamentario
// son más frecuentes que con equipos independientes (los partidos parejos se
// juegan distinto al final): se les da más peso. Béisbol: algo menos.
const TIE_WEIGHT = { 'ice-hockey': 1.55, floorball: 1.4, basketball: 1.9, 'american-football': 1.5, handball: 1.3, baseball: 0.8 };

function weightOf(rec, P) {
  if (rec.sport === 'football') return dixonColes(rec, P.lh, P.la);
  const w = TIE_WEIGHT[rec.sport];
  if (!w) return 1;
  const n = rec.nReg || rec.per.length;
  let h = 0;
  let a = 0;
  for (let i = 0; i < n && i < rec.per.length; i++) {
    h += Number(rec.per[i][0]) || 0;
    a += Number(rec.per[i][1]) || 0;
  }
  return h === a ? w : 1;
}

// Corrección de Dixon-Coles para marcadores bajos en fútbol (como en el modelo de goles).
function dixonColes(rec, lh, la) {
  const [h, a] = [rec.per[0][0] + rec.per[1][0], rec.per[0][1] + rec.per[1][1]];
  const rho = -0.08;
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// selections: [{ key, market, sel, line }]. Devuelve Map(key -> { p, pVoid })
// con p = probabilidad de ganar (contando las medias apuestas a la mitad),
// condicionada a que la apuesta no se anule.
export function estimate(params, selections, { n = 3000, seed = 7 } = {}) {
  const gen = params && GENERATORS[params.sport];
  if (!gen || !selections.length) return new Map();
  const r = rng(seed);
  const acc = selections.map(() => ({ w: 0, l: 0, v: 0, n: 0 }));
  const specs = selections.map((s) => (typeof s.market === 'string' ? parseMarketId(s.market) : s.market));
  for (let i = 0; i < n; i++) {
    const rec = gen(params, r);
    const weight = weightOf(rec, params);
    selections.forEach((s, j) => {
      const res = evaluate(specs[j], s.sel, s.line, rec);
      const a = acc[j];
      if (res == null) return;
      a.n += weight;
      if (res === 'won') a.w += weight;
      else if (res === 'lost') a.l += weight;
      else if (res === 'half_won') {
        a.w += weight / 2;
        a.v += weight / 2;
      } else if (res === 'half_lost') {
        a.l += weight / 2;
        a.v += weight / 2;
      } else a.v += weight;
    });
  }
  const out = new Map();
  selections.forEach((s, j) => {
    const a = acc[j];
    if (!a.n || a.w + a.l === 0) return;
    out.set(s.key, { p: a.w / (a.w + a.l), pVoid: a.v / a.n });
  });
  return out;
}

// Tenis: sube o baja el nivel de saque de ambos (sin cambiar la diferencia)
// para que el total de juegos coincida con la probabilidad del Más/Menos.
export function fitTennisGames(P, line, pOver, { n = 400, seed = 11 } = {}) {
  const at = (d) => ({ ...P, ph: clamp(P.ph + d, 0.4, 0.9), pa: clamp(P.pa + d, 0.4, 0.9) });
  const over = (d) => estimate(at(d), [{ key: 'x', market: 'OU.games', sel: 'over', line }], { n, seed }).get('x')?.p ?? 0.5;
  let lo = -0.1;
  let hi = 0.1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (over(mid) < pOver) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}

// Selecciones que el simulador sabe evaluar (todas sus partes).
export function simulable(spec) {
  if (!spec) return false;
  if (spec.t === 'AND' || spec.t === 'OR') return true;
  return true;
}

export { decodeParts };
