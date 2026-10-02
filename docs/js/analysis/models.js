// Modelos estadísticos. A partir de los últimos partidos de cada equipo
// (Sofascore) estiman la probabilidad de cada selección:
//  - goals: goles esperados de cada equipo y distribución de Poisson
//    (fútbol, hockey, béisbol, balonmano...). En las 5 grandes ligas se
//    combina con el xG de Understat.
//  - points: margen y total esperados con distribución normal (básquet...).
//  - tennis: ranking, forma reciente y H2H.
//  - generic: forma reciente y H2H.
import { clamp, logit, normCdf, sigmoid } from '../util.js';
import { isHalfLine } from './markets.js';

const DECAY = 0.85; // peso de cada partido anterior respecto del siguiente

// Resumen ponderado (más peso a lo reciente) de los últimos `n` partidos.
export function teamForm(matches = [], { n = 10, home = null } = {}) {
  const list = matches.filter((m) => m.gf != null && m.ga != null && (home == null || m.home === home)).slice(0, n);
  if (!list.length) return null;
  let w = 0;
  let gf = 0;
  let ga = 0;
  let pts = 0;
  let wins = 0;
  list.forEach((m, k) => {
    const wk = DECAY ** k;
    w += wk;
    gf += wk * m.gf;
    ga += wk * m.ga;
    pts += wk * (m.r === 'W' ? 3 : m.r === 'D' ? 1 : 0);
    wins += wk * (m.r === 'W' ? 1 : 0);
  });
  return { n: list.length, gf: gf / w, ga: ga / w, ppg: pts / w, winRate: wins / w, last5: list.slice(0, 5).map((m) => m.r) };
}

// Forma general mezclada con la de local (o de visitante) si hay datos.
function venueForm(matches, isHome) {
  const all = teamForm(matches);
  if (!all) return null;
  const venue = teamForm(matches, { home: isHome });
  if (!venue || venue.n < 3) return all;
  return { ...all, gf: 0.6 * all.gf + 0.4 * venue.gf, ga: 0.6 * all.ga + 0.4 * venue.ga };
}

const quality = (fh, fa) => (fh && fa ? Math.min(1, Math.min(fh.n, fa.n) / 10) : 0);

// ---- Goles: Poisson ----

function poisson(lambda, max) {
  const p = new Array(max + 1);
  p[0] = Math.exp(-lambda);
  for (let k = 1; k <= max; k++) p[k] = (p[k - 1] * lambda) / k;
  return p;
}

// Probabilidad de cada marcador. En fútbol se corrigen los marcadores bajos
// (Dixon-Coles), que la Poisson simple subestima.
export function scoreMatrix(lh, la, { dixonColes = false } = {}) {
  const max = Math.ceil(Math.max(lh, la) + 8 * Math.sqrt(Math.max(lh, la)) + 3);
  const ph = poisson(lh, max);
  const pa = poisson(la, max);
  const m = ph.map((x) => pa.map((y) => x * y));
  if (dixonColes) {
    const rho = -0.08;
    m[0][0] *= 1 - lh * la * rho;
    m[0][1] *= 1 + lh * rho;
    m[1][0] *= 1 + la * rho;
    m[1][1] *= 1 - rho;
  }
  const total = m.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  return m.map((row) => row.map((x) => x / total));
}

export function scoreOutcomes(m) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let homeZero = 0;
  let awayZero = 0;
  const totals = [];
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      if (i === 0) homeZero += p;
      if (j === 0) awayZero += p;
      totals[i + j] = (totals[i + j] || 0) + p;
    }
  }
  const btts = 1 - homeZero - awayZero + m[0][0];
  const over = (line) => totals.reduce((s, p, k) => (k > line ? s + p : s), 0);
  const handicap = (line) => {
    let p = 0;
    for (let i = 0; i < m.length; i++) for (let j = 0; j < m[i].length; j++) if (i - j + line > 0) p += m[i][j];
    return p;
  };
  return { home, draw, away, btts, over, handicap };
}

export function goalsModel(ev, d, cfg, ctx = {}) {
  const fh = venueForm(d.lastHome || [], true);
  const fa = venueForm(d.lastAway || [], false);
  if (!fh || !fa) return null;
  const n = Math.min(fh.n, fa.n);
  // Goles promedio por equipo en los partidos de ambos: referencia de la liga.
  const mu = clamp((fh.gf + fh.ga + fa.gf + fa.ga) / 4, 0.2, 60);
  const ha = cfg.neutral ? 1 : cfg.ha || 1.08;
  const shrink = (x) => (n * x + 3 * mu) / (n + 3); // con pocos partidos, acercar a la media
  let lh = (shrink(fh.gf) * shrink(fa.ga)) / mu;
  let la = (shrink(fa.gf) * shrink(fh.ga)) / mu;
  lh *= Math.sqrt(ha);
  la /= Math.sqrt(ha);
  let usedXg = false;
  if (ctx.xg?.home?.xgFor != null && ctx.xg?.away?.xgFor != null) {
    const xh = ((ctx.xg.home.xgFor + ctx.xg.away.xgAgainst) / 2) * 1.05;
    const xa = ((ctx.xg.away.xgFor + ctx.xg.home.xgAgainst) / 2) / 1.05;
    lh = 0.5 * lh + 0.5 * xh;
    la = 0.5 * la + 0.5 * xa;
    usedXg = true;
  }
  lh = clamp(lh, 0.05, mu * 4);
  la = clamp(la, 0.05, mu * 4);
  const o = scoreOutcomes(scoreMatrix(lh, la, { dixonColes: ev.sport === 'football' }));
  const c = [];
  if (cfg.draw) {
    c.push(['1X2', 'home', null, o.home], ['1X2', 'draw', null, o.draw], ['1X2', 'away', null, o.away]);
    if (cfg.dc) c.push(['DC', '1X', null, o.home + o.draw], ['DC', 'X2', null, o.draw + o.away], ['DC', '12', null, o.home + o.away]);
  } else {
    // Sin empate (prórroga o extra innings): el empate se reparte casi a medias.
    const share = cfg.neutral ? 0.5 : 0.53;
    c.push(['ML', 'home', null, o.home + share * o.draw], ['ML', 'away', null, o.away + (1 - share) * o.draw]);
  }
  for (const line of new Set([...(cfg.lines || []), ...(ctx.lines?.OU || [])])) {
    if (!isHalfLine(line) || line <= 0) continue;
    const p = o.over(line);
    c.push(['OU', 'over', line, p], ['OU', 'under', line, 1 - p]);
  }
  if (cfg.btts) c.push(['BTTS', 'yes', null, o.btts], ['BTTS', 'no', null, 1 - o.btts]);
  for (const line of ctx.lines?.HCP || []) {
    if (!isHalfLine(line)) continue;
    const p = o.handicap(line);
    c.push(['HCP', 'home', line, p], ['HCP', 'away', line, 1 - p]);
  }
  return {
    kind: 'goals',
    quality: quality(fh, fa),
    form: { home: fh, away: fa },
    expected: { home: lh, away: la, total: lh + la, sdTotal: Math.sqrt(lh + la), margin: lh - la, sdMargin: Math.sqrt(lh + la), xg: usedXg },
    strength: (fh.gf - fh.ga - (fa.gf - fa.ga)) / (2 * mu),
    candidates: c.map(([market, sel, line, p]) => ({ market, sel, line, p: clamp(p, 0.001, 0.999) })),
  };
}

// ---- Puntos: normal ----

export function pointsModel(ev, d, cfg, ctx = {}) {
  const fh = venueForm(d.lastHome || [], true);
  const fa = venueForm(d.lastAway || [], false);
  if (!fh || !fa) return null;
  const n = Math.min(fh.n, fa.n);
  const total = (fh.gf + fa.ga) / 2 + (fa.gf + fh.ga) / 2;
  const margin = (((fh.gf - fh.ga) - (fa.gf - fa.ga)) / 2) * (n / (n + 2)) + (cfg.neutral ? 0 : cfg.ha || 0);
  const sdM = cfg.sdMarginAbs || Math.max(4, (cfg.sdMargin || 0.055) * total);
  const sdT = cfg.sdTotalAbs || Math.max(5, (cfg.sdTotal || 0.08) * total);
  const pHome = normCdf(margin / sdM);
  const c = [
    ['ML', 'home', null, pHome],
    ['ML', 'away', null, 1 - pHome],
  ];
  for (const line of ctx.lines?.OU || []) {
    if (!isHalfLine(line)) continue;
    const p = 1 - normCdf((line - total) / sdT);
    c.push(['OU', 'over', line, p], ['OU', 'under', line, 1 - p]);
  }
  for (const line of ctx.lines?.HCP || []) {
    if (!isHalfLine(line)) continue;
    const p = normCdf((margin + line) / sdM);
    c.push(['HCP', 'home', line, p], ['HCP', 'away', line, 1 - p]);
  }
  return {
    kind: 'points',
    quality: quality(fh, fa),
    form: { home: fh, away: fa },
    expected: { home: (total + margin) / 2, away: (total - margin) / 2, total, sdTotal: sdT, margin, sdMargin: sdM },
    strength: margin / sdM,
    candidates: c.map(([market, sel, line, p]) => ({ market, sel, line, p: clamp(p, 0.001, 0.999) })),
  };
}

// ---- Tenis y resto: ganador ----

function smoothedWinRate(f) {
  return f ? (f.winRate * f.n + 1) / (f.n + 2) : null;
}

function winnerModel(ev, d, cfg, { useRanking }) {
  const parts = []; // [logit a favor del local, peso]
  if (useRanking && ev.home?.ranking && ev.away?.ranking) {
    parts.push([0.75 * (Math.log(ev.away.ranking) - Math.log(ev.home.ranking)), 0.6]);
  }
  const fh = teamForm(d.lastHome || []);
  const fa = teamForm(d.lastAway || []);
  if (fh && fa) parts.push([logit(smoothedWinRate(fh)) - logit(smoothedWinRate(fa)), 0.4]);
  const h2h = d.h2h;
  if (h2h && h2h.homeWins + h2h.awayWins >= 2) parts.push([Math.log((h2h.homeWins + 1) / (h2h.awayWins + 1)), 0.2]);
  if (!parts.length) return null;
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  let z = parts.reduce((s, [l, w]) => s + l * w, 0) / weight;
  if (!cfg.neutral) z += 0.15; // ventaja de local
  const pHome = sigmoid(clamp(z, -4, 4));
  return {
    kind: useRanking ? 'tennis' : 'generic',
    quality: fh && fa ? Math.min(1, Math.min(fh.n, fa.n) / 10) * (useRanking && ev.home?.ranking ? 1 : 0.7) : 0.3,
    form: { home: fh, away: fa },
    expected: null,
    strength: z,
    candidates: [
      { market: 'ML', sel: 'home', line: null, p: clamp(pHome, 0.001, 0.999) },
      { market: 'ML', sel: 'away', line: null, p: clamp(1 - pHome, 0.001, 0.999) },
    ],
  };
}

export const tennisModel = (ev, d, cfg) => winnerModel(ev, d, cfg, { useRanking: true });
export const genericModel = (ev, d, cfg) => winnerModel(ev, d, cfg, { useRanking: false });

export function predict(ev, details, cfg, ctx) {
  const d = details || {};
  switch (cfg.model) {
    case 'goals':
      return goalsModel(ev, d, cfg, ctx);
    case 'points':
      return pointsModel(ev, d, cfg, ctx);
    case 'tennis':
      return tennisModel(ev, d, cfg);
    default:
      return genericModel(ev, d, cfg);
  }
}

// Mercados que se analizan en cada deporte.
export function allowedMarkets(cfg) {
  if (cfg.model === 'tennis' || cfg.model === 'generic') return new Set(['ML']);
  const set = new Set(['OU', 'HCP']);
  if (cfg.draw) {
    set.add('1X2');
    if (cfg.dc) set.add('DC');
    if (cfg.btts) set.add('BTTS');
  } else {
    set.add('ML');
  }
  return set;
}
