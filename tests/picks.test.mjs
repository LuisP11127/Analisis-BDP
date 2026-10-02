import assert from 'node:assert/strict';
import test from 'node:test';
import { bestCombo, buildCombos, DEFAULT_SETTINGS, levelOf, selectPicks } from '../docs/js/analysis/picks.js';
import { rng } from '../docs/js/util.js';

const cand = (eventId, key, p, price, prices = { apuestatotal: price }) => ({ eventId, key, p, best: { price, source: 'apuestatotal' }, prices });

test('niveles de confianza', () => {
  assert.equal(levelOf(0.85), 'alta');
  assert.equal(levelOf(0.75), 'moderada_alta');
  assert.equal(levelOf(0.65), 'moderada');
  assert.equal(levelOf(0.55), null);
});

test('un pick por partido y nivel, el de mejor valor esperado', () => {
  const picks = selectPicks([
    cand(1, 'OU|over|0.5', 0.95, 1.05), // cuota demasiado baja
    cand(1, 'DC|1X|', 0.86, 1.25),
    cand(1, '1X2|home|', 0.82, 1.35),
    cand(1, 'OU|over|1.5', 0.74, 1.4),
    cand(2, '1X2|home|', 0.62, 1.7),
  ]);
  assert.deepEqual(
    picks.map((p) => [p.eventId, p.key, p.level]),
    [
      [1, '1X2|home|', 'alta'],
      [1, 'OU|over|1.5', 'moderada_alta'],
      [2, '1X2|home|', 'moderada'],
    ],
  );
});

function bruteForce(options, target, maxLegs) {
  let best = null;
  const n = options.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const legs = options.filter((_, i) => mask & (1 << i));
    if (legs.length > maxLegs || new Set(legs.map((o) => o.eventId)).size !== legs.length) continue;
    const odds = legs.reduce((x, o) => x * o.price, 1);
    const p = legs.reduce((x, o) => x * o.p, 1);
    if (odds >= target && (!best || p > best.p)) best = { p, legs };
  }
  return best;
}

test('la combinada óptima coincide con la búsqueda exhaustiva', () => {
  const r = rng(42);
  for (let t = 0; t < 30; t++) {
    const options = Array.from({ length: 10 }, (_, i) => {
      const p = 0.62 + 0.33 * r();
      return { key: `k${i}`, eventId: Math.floor(i / 2), p, price: Math.round((1 / p) * (0.9 + 0.25 * r()) * 100) / 100 + 0.05 };
    });
    const dp = bestCombo(options, 5, 6);
    // Toda combinada con cuota >= 5 * 1.013 es alcanzable pese al redondeo hacia abajo.
    const bf = bruteForce(options, 5 * 1.013, 6);
    if (dp) assert.ok(dp.reduce((x, o) => x * o.price, 1) >= 5, 'nunca por debajo del objetivo');
    if (!bf) continue;
    const pDp = dp.reduce((x, o) => x * o.p, 1);
    assert.ok(pDp >= bf.p - 1e-12, `combinada subóptima: ${pDp} vs ${bf.p}`);
  }
});

test('combinadas por casa, cuota objetivo y sin repetir partido', () => {
  const candidates = [];
  for (let e = 0; e < 8; e++) {
    candidates.push(cand(e, 'DC|1X|', 0.86, 1.3, { apuestatotal: 1.3, betano: 1.28 }));
    candidates.push(cand(e, 'OU|over|1.5', 0.78, 1.45, { apuestatotal: 1.45 }));
  }
  const combos = buildCombos(candidates, DEFAULT_SETTINGS);
  assert.ok(combos.length >= 2);
  for (const k of combos) {
    assert.ok(k.odds >= k.target, `cuota ${k.odds} < ${k.target}`);
    assert.equal(new Set(k.legs.map((l) => l.eventId)).size, k.legs.length);
    for (const l of k.legs) assert.ok(l.price > 1);
  }
  assert.ok(combos.some((k) => k.source === 'betano'));
});

test('los ajustes eligen qué tipos de mercado pueden salir en picks y combinadas', async () => {
  const { marketGroupOf } = await import('../docs/js/analysis/picks.js');
  assert.equal(marketGroupOf('resultado'), 'principales');
  assert.equal(marketGroupOf('games'), 'principales');
  assert.equal(marketGroupOf('corners'), 'estadisticas');
  assert.equal(marketGroupOf('periodo'), 'periodos');
  assert.equal(marketGroupOf('combinado'), 'combinados');
  const c = (eventId, key, family, p, price) => ({ eventId, key, family, p, best: { source: 'betano', price }, prices: { betano: price } });
  const list = [c(1, 'OU.corners|over|8.5', 'corners', 0.85, 1.4), c(1, '1X2|home|', 'resultado', 0.82, 1.3), c(2, 'OU|over|1.5', 'total', 0.8, 1.35)];
  const all = selectPicks(list);
  assert.equal(all.find((x) => x.eventId === 1).key, 'OU.corners|over|8.5');
  const s = { ...DEFAULT_SETTINGS, marketGroups: ['principales'] };
  assert.equal(selectPicks(list, s).find((x) => x.eventId === 1).key, '1X2|home|');
  for (const k of buildCombos(list, { ...s, comboTargets: [1.5] })) assert.ok(k.legs.every((l) => !l.key.includes('corners')));
});
