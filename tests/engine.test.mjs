import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeEvent, blend } from '../docs/js/analysis/engine.js';
import { FEATURES } from '../docs/js/analysis/features.js';
import { offersFromApuestaTotal, offersFromSofascore } from '../docs/js/analysis/markets.js';
import { Corrector } from '../docs/js/analysis/neural.js';
import { buildCombos, DEFAULT_SETTINGS, selectPicks } from '../docs/js/analysis/picks.js';
import { compactAnalysis, daySummary, trainingRows } from '../docs/js/history.js';

const last = (pairs, start = Date.parse('2026-09-28T12:00:00Z')) =>
  pairs.map(([gf, ga], i) => ({ start: start - i * 7 * 864e5, home: i % 2 === 0, gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D' }));

const ev = {
  id: 101,
  sport: 'football',
  start: Date.parse('2026-10-02T18:45:00Z'),
  tournament: { id: 10783, name: 'UEFA Nations League' },
  category: { name: 'Europe' },
  home: { id: 1, name: 'Belgium', short: 'Belgium' },
  away: { id: 2, name: 'Türkiye', short: 'Türkiye' },
  state: 'pendiente',
};

const details = {
  lastHome: last([[3, 1], [2, 0], [1, 1], [4, 0], [2, 1], [0, 1], [3, 0], [2, 2], [1, 0], [2, 0]]),
  lastAway: last([[1, 1], [0, 2], [2, 1], [1, 3], [0, 0], [1, 2], [2, 2], [0, 1], [1, 1], [3, 2]]),
  h2h: { homeWins: 3, draws: 1, awayWins: 1 },
  missing: { home: [], away: [{ player: 'X' }, { player: 'Y' }] },
  votes: { home: 0.68, draw: 0.17, away: 0.15 },
  odds: [
    { name: 'Full time', group: null, choices: [{ name: '1', price: 1.5 }, { name: 'X', price: 4.4 }, { name: '2', price: 6 }] },
    { name: 'Match goals', group: '2.5', choices: [{ name: 'Over', price: 1.45 }, { name: 'Under', price: 2.7 }] },
  ],
};

const atMarkets = [
  { name: 'Resultado del partido (1X2)', type: 'ML0', selections: [{ name: 'Empate', price: 4.55 }, { name: 'Bélgica', price: 1.52 }, { name: 'Turquía', price: 5.3 }] },
  { name: 'Total de goles', type: 'OU200', selections: [{ name: 'Más de 1.5', price: 1.13 }, { name: 'Menos de 1.5', price: 5.9 }, { name: 'Más de 2.5', price: 1.43 }, { name: 'Menos de 2.5', price: 2.79 }] },
  { name: 'Ambos equipos anotan', type: 'QA158', selections: [{ name: 'Sí', price: 1.56 }, { name: 'No', price: 2.37 }] },
  { name: 'Doble Oportunidad', type: 'QA61', selections: [{ name: 'Bélgica o Empate', price: 1.17 }, { name: 'Empate o Turquía', price: 2.47 }, { name: 'Bélgica o Turquía', price: 1.21 }] },
];

function offers() {
  return [...offersFromSofascore(details.odds, ev), ...offersFromApuestaTotal(atMarkets, { home: 'Bélgica', away: 'Turquía' }, ev)];
}

test('la probabilidad base queda entre el modelo y el mercado', () => {
  const p = blend(0.8, 0.6, 1, 'goals');
  assert.ok(p > 0.6 && p < 0.8);
  assert.equal(blend(null, 0.6, 1, 'goals'), 0.6);
});

test('analiza un partido con estadísticas y cuotas de dos casas', () => {
  const { model, candidates } = analyzeEvent(ev, details, offers(), {});
  assert.ok(model, 'debe haber modelo con 10 partidos por equipo');
  const keys = candidates.map((c) => c.key);
  for (const k of ['1X2|home|', '1X2|draw|', '1X2|away|', 'DC|1X|', 'OU|over|2.5', 'BTTS|yes|']) assert.ok(keys.includes(k), `falta ${k}`);
  const home = candidates.find((c) => c.key === '1X2|home|');
  assert.equal(home.best.source, 'apuestatotal');
  assert.equal(home.best.price, 1.52);
  assert.equal(home.prices.sofascore, 1.5);
  assert.ok(home.pMarket > 0.6 && home.pMarket < 0.67);
  assert.equal(home.label, 'Gana Belgium');
  for (const c of candidates) {
    assert.equal(c.x.length, FEATURES.length);
    assert.ok(c.x.every(Number.isFinite));
    assert.ok(c.p > 0 && c.p < 1);
    assert.equal(c.p, c.pBase, 'el análisis estadístico usa la probabilidad base');
  }
  // OU 0.5 está en el modelo pero ninguna casa lo ofrece: no se incluye.
  assert.ok(!keys.includes('OU|over|0.5'));
});

test('la red sin entrenar da lo mismo que el análisis estadístico', () => {
  const net = new Corrector({ inputs: FEATURES.length });
  const est = analyzeEvent(ev, details, offers(), {}).candidates;
  const rn = analyzeEvent(ev, details, offers(), { network: net, method: 'red_neuronal' }).candidates;
  assert.deepEqual(
    rn.map((c) => c.p),
    est.map((c) => c.p),
  );
});

test('del análisis al historial: picks, combinadas, filas de entrenamiento y resumen', () => {
  const { candidates } = analyzeEvent(ev, details, offers(), {});
  const second = { ...ev, id: 102, home: { id: 3, name: 'France' }, away: { id: 4, name: 'Italy' } };
  const at2 = [{ name: 'Doble Oportunidad', type: 'QA61', selections: [{ name: 'Francia o Empate', price: 1.2 }, { name: 'Empate o Italia', price: 2.82 }, { name: 'Francia o Italia', price: 1.18 }] }];
  const more = analyzeEvent(second, details, offersFromApuestaTotal(at2, { home: 'Francia', away: 'Italia' }, second), {}).candidates;
  const all = [...candidates, ...more];
  const result = {
    id: 'est-1',
    method: 'estadistico',
    created: new Date().toISOString(),
    date: '2026-10-02',
    settings: DEFAULT_SETTINGS,
    network: null,
    sources: {},
    events: { 101: { home: 'Belgium', away: 'Türkiye' }, 102: { home: 'France', away: 'Italy' } },
    candidates: all,
    picks: selectPicks(all),
    combos: buildCombos(all, { ...DEFAULT_SETTINGS, comboTargets: [1.3] }),
  };
  assert.ok(result.picks.length > 0);
  const stored = compactAnalysis(result);
  assert.equal(stored.picks.length, result.picks.length);
  assert.ok(stored.picks.every((p) => p.status === 'pending' && p.match && p.odds > 1));
  for (const k of stored.combos) assert.ok(k.legs.every((l) => l.market && l.match));
  const rows = trainingRows(result);
  assert.equal(rows.length, all.length);
  assert.ok(rows.every((r) => r.y === null && r.x.length === FEATURES.length));
  const s = daySummary({ analyses: [stored] });
  assert.equal(s.n, stored.picks.length);
  assert.equal(s.pending, stored.picks.length);
});
