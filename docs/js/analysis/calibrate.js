// Calibración de lo esperado (goles o puntos de cada equipo) con las
// probabilidades base del resultado y del total (modelo + mercado). Así los
// mercados que se simulan (mitades, marcador exacto, combinados...) quedan
// coherentes con lo que dicen las cuotas principales, aunque el modelo propio
// tenga pocos datos o no exista.
import { clamp, logit, normCdf } from '../util.js';
import { scoreMatrix, scoreOutcomes } from './models.js';

// Valores de partida cuando no hay modelo (solo cuotas).
const PRIOR_GOALS = {
  football: [1.45, 1.15],
  futsal: [3.1, 2.7],
  'ice-hockey': [3.1, 2.8],
  handball: [28, 26],
  baseball: [4.6, 4.3],
  waterpolo: [11, 10],
  floorball: [5, 4.4],
  bandy: [5, 4.2],
};
const PRIOR_POINTS = { basketball: 200, 'american-football': 44, rugby: 46, 'aussie-rules': 165 };

// Nelder-Mead en 2 dimensiones (suficiente para 2 parámetros).
function minimize(f, x0, step, iters = 80) {
  let s = [x0, [x0[0] + step[0], x0[1]], [x0[0], x0[1] + step[1]]].map((x) => ({ x, v: f(x) }));
  for (let i = 0; i < iters; i++) {
    s.sort((a, b) => a.v - b.v);
    const [b, g, w] = s;
    const c = [(b.x[0] + g.x[0]) / 2, (b.x[1] + g.x[1]) / 2];
    const at = (t) => [c[0] + t * (w.x[0] - c[0]), c[1] + t * (w.x[1] - c[1])];
    const r = { x: at(-1) };
    r.v = f(r.x);
    if (r.v < b.v) {
      const e = { x: at(-2) };
      e.v = f(e.x);
      s = [b, g, e.v < r.v ? e : r];
    } else if (r.v < g.v) s = [b, g, r];
    else {
      const k = { x: at(0.5) };
      k.v = f(k.x);
      if (k.v < w.v) s = [b, g, k];
      else s = [b, ...[g, w].map((p) => ({ x: [(b.x[0] + p.x[0]) / 2, (b.x[1] + p.x[1]) / 2] })).map((p) => ({ ...p, v: f(p.x) }))];
    }
    if (Math.abs(s[0].v - s[2].v) < 1e-10) break;
  }
  s.sort((a, b) => a.v - b.v);
  return s[0].x;
}

// targets: [{ market: '1X2'|'ML'|'OU'|'HCP', sel, line, p }] (probabilidades base).
// Devuelve el "expected" ajustado (mismo formato que el de models.js) o el
// original si no hay nada con qué calibrar.
export function calibrateExpected(sport, cfg, expected, targets) {
  const useful = targets.filter((t) => t.p > 0.01 && t.p < 0.99 && ['1X2', 'ML', 'OU', 'HCP'].includes(t.market));
  // Hace falta algo del resultado (o hándicap) y algo del total; con una sola
  // cosa el ajuste es ambiguo y se usa el modelo tal cual.
  const hasResult = useful.some((t) => t.market !== 'OU');
  const hasTotal = useful.some((t) => t.market === 'OU');
  if (!hasResult || (!hasTotal && !expected)) return expected;
  const err = (pred, p) => (logit(clamp(pred, 0.002, 0.998)) - logit(p)) ** 2;

  if (cfg.model === 'goals') {
    const prior = expected ? [expected.home, expected.away] : PRIOR_GOALS[sport] || [1.4, 1.1];
    const dixonColes = sport === 'football';
    const share = cfg.neutral ? 0.5 : 0.53;
    const loss = ([a, b]) => {
      const lh = Math.exp(a);
      const la = Math.exp(b);
      const o = scoreOutcomes(scoreMatrix(lh, la, { dixonColes }));
      let s = 0;
      for (const t of useful) {
        let pred;
        if (t.market === '1X2') pred = o[t.sel];
        else if (t.market === 'ML') pred = t.sel === 'home' ? o.home + share * o.draw : o.away + (1 - share) * o.draw;
        else if (t.market === 'OU') pred = t.sel === 'over' ? o.over(t.line) : 1 - o.over(t.line);
        else pred = t.sel === 'home' ? o.handicap(t.line) : 1 - o.handicap(t.line); // línea = hándicap del local
        s += err(pred, t.p);
      }
      // Sin total en el mercado se mantiene el total del modelo.
      if (!hasTotal) s += 4 * (Math.log(lh + la) - Math.log(prior[0] + prior[1])) ** 2;
      return s;
    };
    const [a, b] = minimize(loss, [Math.log(prior[0]), Math.log(prior[1])], [0.15, 0.15]);
    const lh = Math.exp(a);
    const la = Math.exp(b);
    return { ...(expected || {}), home: lh, away: la, total: lh + la, sdTotal: Math.sqrt(lh + la), margin: lh - la, sdMargin: Math.sqrt(lh + la), calibrated: true };
  }

  if (cfg.model === 'points') {
    const total0 = expected?.total ?? useful.find((t) => t.market === 'OU')?.line ?? PRIOR_POINTS[sport] ?? 100;
    const sdM = expected?.sdMargin ?? (cfg.sdMarginAbs || Math.max(4, (cfg.sdMargin || 0.055) * total0));
    const sdT = expected?.sdTotal ?? (cfg.sdTotalAbs || Math.max(5, (cfg.sdTotal || 0.08) * total0));
    const loss = ([total, margin]) => {
      let s = 0;
      for (const t of useful) {
        let pred;
        if (t.market === 'ML' || t.market === '1X2') {
          const ph = normCdf(margin / sdM);
          pred = t.sel === 'home' ? ph : t.sel === 'away' ? 1 - ph : null;
        } else if (t.market === 'OU') pred = 1 - normCdf((t.line - total) / sdT);
        else pred = normCdf((margin + t.line) / sdM); // línea = hándicap del local
        if ((t.market === 'OU' && t.sel === 'under') || (t.market === 'HCP' && t.sel === 'away')) pred = 1 - pred;
        if (pred != null) s += err(pred, t.p);
      }
      if (!hasTotal) s += ((total - total0) / sdT) ** 2;
      return s;
    };
    const [total, margin] = minimize(loss, [total0, expected?.margin ?? 0], [sdT / 2, sdM / 2]);
    return { ...(expected || {}), home: (total + margin) / 2, away: (total - margin) / 2, total, margin, sdTotal: sdT, sdMargin: sdM, calibrated: true };
  }
  return expected;
}
