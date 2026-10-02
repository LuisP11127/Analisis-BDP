// Niveles de confianza y combinadas.
import { groupBy } from '../util.js';

export const LEVELS = [
  { id: 'alta', name: 'Alta' },
  { id: 'moderada_alta', name: 'Moderada-alta' },
  { id: 'moderada', name: 'Moderada' },
];

// Grupos de mercados que se pueden activar o desactivar en los ajustes.
// family: la de catalog.familyOf (resultado, total, periodo, corners...).
export const MARKET_GROUPS = [
  { id: 'principales', name: 'Resultado, total, hándicap y ambos marcan' },
  { id: 'periodos', name: 'Mitades, cuartos, periodos, sets y entradas' },
  { id: 'estadisticas', name: 'Córners, tarjetas, tiros, faltas y otras estadísticas' },
  { id: 'marcador', name: 'Marcador exacto y margen de victoria' },
  { id: 'combinados', name: 'Combinados de la casa (descanso/final, resultado y total…)' },
  { id: 'otros', name: 'Otros (primer gol, par/impar, prórroga, carrera a…)' },
];
const MAIN = new Set(['resultado', 'total', 'handicap', 'ambos', 'games', 'sets', 'legs', 'maps', 'rounds', 'frames']);
export function marketGroupOf(family) {
  if (!family || MAIN.has(family)) return 'principales';
  if (family === 'periodo') return 'periodos';
  if (family === 'marcador' || family === 'margen') return 'marcador';
  if (family === 'combinado') return 'combinados';
  if (family === 'otro') return 'otros';
  return 'estadisticas';
}
const allowedGroup = (c, s) => !s.marketGroups || s.marketGroups.includes(marketGroupOf(c.family));

export const DEFAULT_SETTINGS = {
  alta: 0.8, // probabilidad mínima para "alta"
  moderadaAlta: 0.7,
  moderada: 0.6,
  minOdds: 1.15, // no se recomiendan cuotas más bajas (ganancia casi nula)
  comboTargets: [5, 10], // cuota mínima de cada combinada
  comboMinProb: 0.7, // probabilidad mínima de cada selección de una combinada
  comboMaxLegs: 8,
  marketGroups: MARKET_GROUPS.map((g) => g.id), // mercados que pueden salir en picks y combinadas
};

export const BOOKMAKERS = { apuestatotal: 'Apuesta Total', betano: 'Betano', sofascore: 'Sofascore (referencia)' };

export function levelOf(p, s = DEFAULT_SETTINGS) {
  if (p >= s.alta) return 'alta';
  if (p >= s.moderadaAlta) return 'moderada_alta';
  if (p >= s.moderada) return 'moderada';
  return null;
}

const levelRank = (id) => LEVELS.findIndex((l) => l.id === id);

// Por cada partido y nivel, la selección con mejor valor esperado
// (probabilidad × cuota) entre las que caen en ese nivel.
export function selectPicks(candidates, s = DEFAULT_SETTINGS) {
  const picks = [];
  for (const list of groupBy(
    candidates.filter((c) => c.best && c.best.price >= s.minOdds && allowedGroup(c, s)),
    (c) => c.eventId,
  ).values()) {
    for (const level of LEVELS) {
      const inLevel = list.filter((c) => levelOf(c.p, s) === level.id);
      if (!inLevel.length) continue;
      const best = inLevel.reduce((a, b) => (b.p * b.best.price > a.p * a.best.price ? b : a));
      picks.push({ ...best, level: level.id });
    }
  }
  return picks.sort((a, b) => levelRank(a.level) - levelRank(b.level) || b.p - a.p);
}

// Combinación de selecciones (máximo una por partido) que alcanza la cuota
// `target` con la mayor probabilidad conjunta. Mochila en escala logarítmica:
// coste = -log(p), peso = log(cuota) redondeado hacia abajo, así la cuota
// real nunca queda por debajo del objetivo.
export function bestCombo(options, target, maxLegs = 8) {
  const STEP = 0.002;
  const T = Math.ceil(Math.log(target) / STEP);
  const groups = [...groupBy(options, (o) => o.eventId).values()];
  const width = T + 1;
  let dp = new Float64Array((maxLegs + 1) * width).fill(Infinity);
  dp[0] = 0;
  const trace = [];
  for (const g of groups) {
    const next = dp.slice();
    const chosen = new Int16Array(dp.length).fill(-1);
    const from = new Int32Array(dp.length).fill(-1);
    for (let l = 0; l < maxLegs; l++) {
      for (let w = 0; w <= T; w++) {
        const cost = dp[l * width + w];
        if (cost === Infinity) continue;
        g.forEach((o, oi) => {
          const w2 = Math.min(T, w + Math.floor(Math.log(o.price) / STEP));
          const c2 = cost - Math.log(o.p);
          const idx = (l + 1) * width + w2;
          if (c2 < next[idx]) {
            next[idx] = c2;
            chosen[idx] = oi;
            from[idx] = l * width + w;
          }
        });
      }
    }
    trace.push({ g, chosen, from });
    dp = next;
  }
  let end = -1;
  for (let l = 1; l <= maxLegs; l++) {
    const idx = l * width + T;
    if (dp[idx] < Infinity && (end < 0 || dp[idx] < dp[end])) end = idx;
  }
  if (end < 0) return null;
  const legs = [];
  let idx = end;
  for (let gi = trace.length - 1; gi >= 0 && idx > 0; gi--) {
    const { g, chosen, from } = trace[gi];
    if (chosen[idx] >= 0) {
      legs.push(g[chosen[idx]]);
      idx = from[idx];
    }
  }
  return legs.reverse();
}

// Combinadas por casa de apuestas (una combinada se juega en una sola casa).
// Para cada cuota objetivo se dan hasta dos alternativas con partidos distintos.
export function buildCombos(candidates, s = DEFAULT_SETTINGS, sources = ['apuestatotal', 'betano']) {
  const combos = [];
  const seen = new Set();
  for (const source of sources) {
    const options = candidates
      .filter((c) => c.p >= s.comboMinProb && c.prices?.[source] >= s.minOdds && allowedGroup(c, s))
      .map((c) => ({ key: c.key, eventId: c.eventId, p: c.p, price: c.prices[source] }));
    for (const target of s.comboTargets) {
      const used = new Set();
      for (let alt = 0; alt < 2; alt++) {
        const legs = bestCombo(
          options.filter((o) => !used.has(o.eventId)),
          target,
          s.comboMaxLegs,
        );
        if (!legs || legs.length < 2) break;
        legs.forEach((o) => used.add(o.eventId));
        const id = `${source}:${legs.map((o) => o.key + '@' + o.eventId).sort().join(',')}`;
        if (seen.has(id)) continue;
        seen.add(id);
        combos.push({
          id: `c${combos.length + 1}`,
          source,
          target,
          legs: legs.map((o) => ({ key: o.key, eventId: o.eventId, price: o.price, p: o.p })),
          odds: legs.reduce((x, o) => x * o.price, 1),
          p: legs.reduce((x, o) => x * o.p, 1),
        });
      }
    }
  }
  return combos.sort((a, b) => a.target - b.target || b.p - a.p);
}
