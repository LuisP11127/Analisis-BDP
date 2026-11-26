// Props de jugador de básquet (NBA): datos de ESPN y probabilidad de cada línea.
//
// Datos publicados por GitHub Actions (scripts/collect-data.mjs):
//   jugadores/nba.json            próximos partidos (con lesionados) y, por equipo,
//                                 los últimos partidos de cada jugador
//   jugadores/nba-resultados.json fichas de los partidos de los últimos días
//                                 (para liquidar)
// Ficha de un jugador en un partido (box): [min, pts, reb, ast, 3pm, 3pa, fgm, fga, ftm, fta].
import { clamp, normCdf } from '../util.js';
import { BOX, PLAYER_STATS, playerSlug, playerValue } from './catalog.js';
import { matchEvent } from './matching.js';

export const PLAYER_GAMES = 12; // últimos partidos de cada jugador que se usan
const MIN_GAMES = 5; // con menos partidos jugados no se calcula
const DAY = 86400000;

// ---- Formato de los archivos ----

// Partido de ESPN (getNbaGame) -> registro compacto para la caché y los resultados.
export const compactGame = (g) => ({
  id: g.id,
  start: g.start,
  state: g.state,
  home: g.home,
  away: g.away,
  score: g.score,
  players: g.players.map((p) => [p.name, p.side === 'home' ? 0 : 1, ...p.box]),
});

// Últimos partidos de los jugadores de un equipo a partir de sus partidos
// (compactGame), del más reciente al más antiguo.
export function teamLogs(teamId, games) {
  const out = { games: [], players: {} };
  for (const g of games) {
    const side = String(g.home.id) === String(teamId) ? 0 : String(g.away.id) === String(teamId) ? 1 : null;
    if (side == null) continue;
    const t = side === 0 ? g.home : g.away;
    out.name ||= t.name;
    out.abbr ||= t.abbr;
    const day = Math.round(g.start / DAY);
    out.games.push(day);
    for (const [name, s, ...box] of g.players) {
      if (s !== side || !(box[BOX.min] > 0)) continue;
      const slug = playerSlug(name);
      const p = (out.players[slug] ||= { n: name, g: [] });
      p.g.push([day, ...box]);
    }
  }
  return out;
}

// Resultados para liquidar: { id, start, state, home, away, score, p: { slug: box } }.
export function resultOf(g) {
  const p = {};
  for (const [name, , ...box] of g.players) p[playerSlug(name)] = box;
  return { id: g.id, start: g.start, state: g.state, home: g.home.name, away: g.away.name, score: g.score, p };
}

// ---- Emparejar partido y jugador ----

// Partido de ESPN de un evento (por nombres y hora). list: [{ start, home: {name}, away: {name} }].
export function findGame(ev, list) {
  const items = (list || []).map((g) => ({ g, start: g.start, home: typeof g.home === 'string' ? g.home : g.home.name, away: typeof g.away === 'string' ? g.away : g.away.name }));
  const m = matchEvent({ start: ev.start, home: { name: ev.home?.name ?? ev.home }, away: { name: ev.away?.name ?? ev.away } }, items, { toleranceMin: 90 });
  return m ? { game: m.item.g, swapped: m.swapped } : null;
}

// Jugador por su identificador; si no está igual, por apellido e inicial
// ("j_brunson" o "jalen_brunson_jr" -> "jalen_brunson").
export function findPlayer(slug, players) {
  if (!players) return null;
  if (players[slug]) return { key: slug, data: players[slug] };
  const parts = String(slug).split('_');
  const last = parts.at(-1);
  const first = parts[0];
  const hits = Object.keys(players).filter((k) => {
    const q = k.split('_');
    return q.at(-1) === last && q[0][0] === first[0];
  });
  return hits.length === 1 ? { key: hits[0], data: players[hits[0]] } : null;
}

// Datos del partido para el análisis: { game, teams: { home, away }, injuries }.
export function playersFor(ev, data) {
  if (!data?.games?.length || ev.sport !== 'basketball') return null;
  const found = findGame(ev, data.games);
  if (!found) return null;
  const g = found.game;
  const home = data.teams?.[found.swapped ? g.away.id : g.home.id];
  const away = data.teams?.[found.swapped ? g.home.id : g.away.id];
  if (!home && !away) return null;
  return { game: g.id, home: home || null, away: away || null, injuries: g.injuries || {} };
}

// ---- Probabilidad ----

// Dispersión típica (varianza / media) de cada estadística entre partidos.
const DISPERSION = { pts: 3, reb: 1.8, ast: 1.8, threes: 1.4, pra: 3.4, pr: 3.1, pa: 3.1, ra: 2.1, twos: 1.8, twos_a: 2, ftm: 1.8, fta: 1.8 };

function nbPmf(mu, variance, kMax) {
  // Poisson si no hay sobredispersión; si no, binomial negativa.
  const out = [];
  if (variance <= mu * 1.02) {
    let p = Math.exp(-mu);
    for (let k = 0; k <= kMax; k++) {
      out.push(p);
      p *= mu / (k + 1);
    }
    return out;
  }
  const r = (mu * mu) / (variance - mu);
  const q = r / (r + mu);
  let p = Math.pow(q, r);
  for (let k = 0; k <= kMax; k++) {
    out.push(p);
    p *= ((k + r) / (k + 1)) * (1 - q);
  }
  return out;
}

// P(X > line), sin contar el empate en líneas enteras (se devuelve la apuesta).
export function overProb(mu, variance, line) {
  if (!(mu > 0)) return line < 0 ? 1 : 0.001;
  if (mu > 60) {
    const sd = Math.sqrt(Math.max(variance, mu));
    const pOver = 1 - normCdf((Math.floor(line) + 0.5 - mu) / sd);
    if (Number.isInteger(line)) {
      const pEq = normCdf((line + 0.5 - mu) / sd) - normCdf((line - 0.5 - mu) / sd);
      return pOver / Math.max(1e-6, 1 - pEq);
    }
    return pOver;
  }
  const k = Math.floor(line);
  const pmf = nbPmf(mu, variance, Math.max(0, k));
  const upTo = pmf.reduce((a, b) => a + b, 0);
  if (Number.isInteger(line)) return (1 - upTo) / Math.max(1e-6, 1 - pmf[k]);
  return 1 - upTo;
}

// Promedio y varianza ponderados (los partidos recientes pesan más).
function weighted(values) {
  let w = 1;
  let sw = 0;
  let sx = 0;
  const ws = [];
  for (const v of values) {
    ws.push(w);
    sw += w;
    sx += w * v;
    w *= 0.9;
  }
  const mu = sx / sw;
  let sv = 0;
  values.forEach((v, i) => (sv += ws[i] * (v - mu) ** 2));
  return { mu, variance: values.length > 1 ? (sv / sw) * (values.length / (values.length - 1)) : 0 };
}

// Estimación de una estadística de un jugador: { mu, variance, n, min, low, high }.
export function playerEstimate(p, stat) {
  const games = (p?.g || []).slice(0, PLAYER_GAMES);
  if (games.length < MIN_GAMES) return null;
  const values = games.map((row) => playerValue(row.slice(1), stat));
  const { mu, variance } = weighted(values);
  const n = values.length;
  // La varianza se acerca a la típica de la estadística (con pocos partidos es ruidosa).
  const prior = Math.max(mu, 0.3) * (DISPERSION[stat] || 1.8);
  const v = (n * variance + 6 * prior) / (n + 6);
  return { mu, variance: Math.max(v, mu * 0.9), n, min: weighted(games.map((row) => row[1 + BOX.min])).mu, low: Math.min(...values), high: Math.max(...values) };
}

// Probabilidad de una selección de jugador: { p, quality, factors } o null.
// spec: { stat, n: jugador }; info: playersFor(...).
export function playerProbability(spec, sel, line, info) {
  if (!info) return null;
  let found = null;
  let side = null;
  for (const s of ['home', 'away']) {
    const f = findPlayer(spec.n, info[s]?.players);
    if (f) {
      found = f;
      side = s;
      break;
    }
  }
  if (!found) return null;
  const injury = Object.entries(info.injuries || {}).find(([k]) => k === found.key)?.[1] || '';
  if (/^out$|fuera/i.test(injury)) return null; // no juega: no se recomienda
  const team = info[side];
  // Se perdió partidos recientes de su equipo (lesión, rotación): menos confianza.
  const recent = (team.games || []).slice(0, 5);
  const missed = recent.filter((d) => !found.data.g.some((row) => row[0] === d)).length;
  let p;
  let est = null;
  if (spec.stat === 'dd') {
    const games = found.data.g.slice(0, PLAYER_GAMES);
    if (games.length < MIN_GAMES) return null;
    const hits = games.filter((row) => playerValue(row.slice(1), 'dd') === 1).length;
    // Independencia entre puntos, rebotes y asistencias como referencia.
    const q = ['pts', 'reb', 'ast'].map((s) => {
      const e = playerEstimate(found.data, s);
      return e ? overProb(e.mu, e.variance, 9.5) : 0;
    });
    const pInd = q[0] * q[1] + q[0] * q[2] + q[1] * q[2] - 2 * q[0] * q[1] * q[2];
    const pYes = (hits + 4 * pInd) / (games.length + 4);
    p = sel === 'over' ? pYes : 1 - pYes;
    est = { n: games.length, hits };
  } else {
    est = playerEstimate(found.data, spec.stat);
    if (!est) return null;
    const pOver = overProb(est.mu, est.variance, line);
    p = sel === 'over' ? pOver : 1 - pOver;
  }
  let quality = Math.min(1, est.n / 10) * 0.55;
  if (injury) quality *= 0.5;
  if (missed >= 2) quality *= 0.6;
  const f = (x) => (Math.round(x * 10) / 10).toString();
  const what = PLAYER_STATS[spec.stat] || spec.stat;
  const factors = [
    spec.stat === 'dd'
      ? `${found.data.n} (${team.abbr || team.name}): double-double en ${est.hits} de sus últimos ${est.n} partidos`
      : `${found.data.n} (${team.abbr || team.name}): ${f(est.mu)} ${what} por partido en sus últimos ${est.n} (entre ${est.low} y ${est.high}) · ${Math.round(est.min)} min`,
  ];
  if (injury) factors.push(`Parte médico: ${injury}`);
  if (missed >= 2) factors.push(`No jugó ${missed} de los últimos 5 partidos de su equipo`);
  return { p: clamp(p, 0.01, 0.99), quality, factors, player: found.data.n };
}

// ---- Liquidación ----

// Fichas de los jugadores de un partido terminado (o null): busca el partido
// de ESPN por nombres y hora. results: [resultOf(...)].
export function boxesFor(leg, results) {
  const [home, away] = String(leg.match || '').split(' vs ');
  if (!home || !away || !Number.isFinite(leg.start)) return null;
  const found = findGame({ start: leg.start, home: { name: home }, away: { name: away } }, results);
  return found ? found.game : null;
}
