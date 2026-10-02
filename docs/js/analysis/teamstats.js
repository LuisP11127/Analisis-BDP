// Estadísticas promedio de cada equipo (córners, tarjetas, tiros, rebotes,
// aces...) en sus últimos partidos: lo que hace ("for") y lo que le hacen
// ("against"). Las usa la simulación de los mercados de estadísticas.
// Fuentes: Flashscore (df_st de cada partido) y Sofascore (/statistics).

// matches: [{ home: true si el equipo fue local, stats: { código: { ft: [l, v] } } }]
export function teamStatsFrom(matches = []) {
  const acc = {};
  const add = (code, f, a) => {
    if (!Number.isFinite(f) || !Number.isFinite(a)) return;
    const x = (acc[code] ||= { for: 0, against: 0, n: 0 });
    x.for += f;
    x.against += a;
    x.n++;
  };
  for (const m of matches) {
    if (!m?.stats) continue;
    const me = m.home ? 0 : 1;
    const op = 1 - me;
    for (const [code, scopes] of Object.entries(m.stats)) {
      const v = scopes?.ft;
      if (!v || typeof v[0] !== 'number') continue;
      add(code, v[me], v[op]);
    }
    // Tenis: puntos ganados con el saque propio y con el del rival; aces y
    // dobles faltas por juego de saque.
    const sp = m.stats.serve_pts?.ft;
    if (sp && Array.isArray(sp[0]) && sp[me][1] > 0 && sp[op][1] > 0) add('serve', sp[me][0] / sp[me][1], sp[op][0] / sp[op][1]);
    const holds = m.stats.holds?.ft;
    if (holds && Array.isArray(holds[0]) && holds[me][1] > 0 && holds[op][1] > 0) {
      const aces = m.stats.aces?.ft;
      const df = m.stats.df?.ft;
      if (aces) add('aces_pg', aces[me] / holds[me][1], aces[op] / holds[op][1]);
      if (df) add('df_pg', df[me] / holds[me][1], df[op] / holds[op][1]);
    }
  }
  const out = {};
  for (const [code, x] of Object.entries(acc)) out[code] = { for: round(x.for / x.n), against: round(x.against / x.n), n: x.n };
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;

// Une las de dos fuentes (Sofascore y Flashscore) ponderando por partidos.
export function mergeTeamStats(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = { ...b };
  for (const [code, x] of Object.entries(a)) {
    const y = b[code];
    if (!y) out[code] = x;
    else {
      const n = x.n + y.n;
      out[code] = { for: round((x.for * x.n + y.for * y.n) / n), against: round((x.against * x.n + y.against * y.n) / n), n: Math.max(x.n, y.n) };
    }
  }
  return out;
}

// xG de Flashscore en el formato de Understat (para el modelo de goles).
export function xgFromTeamStats(ts) {
  const h = ts?.home?.xg;
  const a = ts?.away?.xg;
  if (!h || !a || h.n < 4 || a.n < 4) return null;
  return { home: { xgFor: h.for, xgAgainst: h.against }, away: { xgFor: a.for, xgAgainst: a.against }, source: 'flashscore' };
}

// Formato compacto: { código: [for, against, n] }.
export const compactTeamStats = (ts) => (ts ? Object.fromEntries(Object.entries(ts).map(([k, x]) => [k, [x.for, x.against, x.n]])) : null);
export const expandTeamStats = (c) => (c ? Object.fromEntries(Object.entries(c).map(([k, [f, a, n]]) => [k, { for: f, against: a, n }])) : null);
