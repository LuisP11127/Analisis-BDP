import assert from 'node:assert/strict';
import test from 'node:test';
import { daySummary, totals } from '../docs/js/history.js';

const pick = (eventId, key, level, status, odds = 1.5) => ({ eventId, key, level, status, odds });
const combo = (status, odds, legs) => ({ source: 'apuestatotal', status, odds, legs: legs.map(([eventId, key]) => ({ eventId, key })) });

const day = {
  date: '2026-10-02',
  analyses: [
    {
      id: 'est-1',
      method: 'estadistico',
      created: '2026-10-02T10:00:00Z',
      picks: [pick(1, '1X2|home|', 'alta', 'won', 1.4), pick(2, 'OU|over|2.5', 'moderada', 'lost', 1.9)],
      combos: [combo('lost', 5.2, [[1, '1X2|home|'], [2, 'OU|over|2.5']])],
    },
    {
      id: 'rn-1',
      method: 'red_neuronal',
      created: '2026-10-02T10:00:00Z',
      picks: [pick(1, '1X2|home|', 'alta', 'won', 1.4), pick(3, 'DC|1X|', 'moderada_alta', 'pending', 1.3)],
      combos: [],
    },
    // El mismo partido analizado otra vez más tarde: cuenta una sola vez (el último).
    {
      id: 'est-2',
      method: 'estadistico',
      created: '2026-10-02T15:00:00Z',
      picks: [pick(2, 'OU|over|2.5', 'moderada_alta', 'lost', 1.9)],
      combos: [combo('lost', 5.2, [[2, 'OU|over|2.5'], [1, '1X2|home|']])],
    },
  ],
};

test('resumen del día por método, sin repetir picks ni combinadas', () => {
  const s = daySummary(day);
  const est = s.methods.estadistico;
  const rn = s.methods.red_neuronal;
  assert.equal(est.n, 2);
  assert.equal(est.won, 1);
  assert.equal(est.lost, 1);
  assert.equal(est.byLevel.alta.won, 1);
  assert.equal(est.byLevel.moderada_alta.lost, 1, 'vale el nivel del análisis más reciente');
  assert.equal(est.byLevel.moderada, undefined);
  assert.equal(est.combos.n, 1);
  assert.ok(Math.abs(est.profit - (0.4 - 1)) < 1e-9);
  assert.equal(rn.n, 2);
  assert.equal(rn.pending, 1);
  assert.equal(rn.combos.n, 0);
  assert.equal(s.pendingAll, 1);
});

test('totales de varios días por método', () => {
  const s = daySummary(day);
  const t = totals({ days: { '2026-10-02': s, '2026-10-03': s } });
  assert.equal(t.methods.estadistico.n, 4);
  assert.equal(t.methods.estadistico.byLevel.alta.won, 2);
  assert.equal(t.methods.estadistico.combos.lost, 2);
  assert.equal(t.methods.red_neuronal.pending, 2);
});

test('medias apuestas, combinadas con medias y apuestas sin datos', async () => {
  const { comboOdds, comboStatus, legStatus, needsRecord } = await import('../docs/js/history.js');
  const s = daySummary({
    analyses: [{ id: 'est-9', method: 'estadistico', created: 'x', picks: [pick(1, 'OU|over|2.25', 'alta', 'half_won', 2), pick(2, 'HCP|home|-0.25', 'alta', 'half_lost', 1.9)], combos: [] }],
  });
  const est = s.methods.estadistico;
  assert.equal(est.won, 1);
  assert.equal(est.lost, 1);
  assert.ok(Math.abs(est.profit - (0.5 - 0.5)) < 1e-9);
  const k = { legs: [{ status: 'won', price: 1.5 }, { status: 'half_won', price: 2 }, { status: 'void', price: 3 }] };
  assert.equal(comboStatus(k), 'won');
  assert.equal(comboOdds(k), 1.5 * 1.5);
  assert.equal(needsRecord('OU'), false);
  assert.equal(needsRecord('OU.corners'), true);
  assert.equal(needsRecord('1X2@h1'), true);
  assert.equal(needsRecord('AND'), true);
  // Partido terminado sin estadísticas de córners: pendiente y, pasados 4 días, nula.
  const leg = { market: 'OU.corners', sel: 'over', line: 8.5, sport: 'football', start: Date.parse('2026-10-01T20:00:00Z') };
  const res = { state: 'finalizado', score: { home: 2, away: 1 } };
  assert.equal(legStatus(leg, res, leg.start + 3 * 3600000), null);
  assert.deepEqual(legStatus(leg, res, leg.start + 5 * 86400000), { status: 'void', noData: true });
  // Con el registro completo se liquida.
  const withRecord = { ...res, record: { state: 'finalizado', final: [2, 1], stats: { corners: { ft: [6, 4] } } } };
  assert.deepEqual(legStatus(leg, withRecord, leg.start + 3 * 3600000), { status: 'won' });
});

test('random bets: se sortea entre los picks de todos los análisis, sin repetir', async () => {
  const { RANDOM, drawRandom, randomCandidates } = await import('../docs/js/history.js');
  const { rng } = await import('../docs/js/util.js');
  const now = Date.parse('2026-10-18T12:00:00Z');
  const later = (h) => now + h * 3600000;
  const p = (eventId, key, level, start, status = 'pending') => ({ ...pick(eventId, key, level, status), start, match: `Partido ${eventId}` });
  const day = {
    date: '2026-10-18',
    analyses: [
      { id: 'est', method: 'estadistico', created: '2026-10-18T08:00:00Z', picks: [p('a', 'OU|over|1.5', 'alta', later(2)), p('a', '1X2|home|', 'moderada', later(2)), p('b', 'DC|1X|', 'alta', later(-1))] },
      { id: 'rn', method: 'red_neuronal', created: '2026-10-18T08:00:00Z', picks: [p('a', 'OU|over|1.5', 'moderada_alta', later(2)), p('c', 'BTTS|yes|', 'moderada', later(5)), p('d', 'OU|under|3.5', 'alta', later(6), 'won')] },
      { id: 'otro', method: 'otro', created: '2026-10-18T09:00:00Z', picks: [p('e', 'ML|home|', 'alta', later(3))] },
      { id: 'r1', method: RANDOM, created: '2026-10-18T10:00:00Z', picks: [p('c', 'BTTS|yes|', 'moderada', later(5))] },
    ],
  };
  const pool = randomCandidates(day, now);
  const byKey = Object.fromEntries(pool.map((x) => [`${x.eventId}|${x.key}`, x]));
  // Sin el partido ya empezado (b), el liquidado (d) ni el que ya salió en un sorteo (c).
  assert.deepEqual(Object.keys(byKey).sort(), ['a|1X2|home|', 'a|OU|over|1.5', 'e|ML|home|']);
  assert.deepEqual(byKey['a|OU|over|1.5'].methods, ['estadistico', 'red_neuronal'], 'el mismo pick de los dos análisis cuenta una vez');
  assert.equal(byKey['e|ML|home|'].methods[0], 'otro', 'también entran los otros análisis');
  assert.equal(byKey['a|OU|over|1.5'].date, '2026-10-18');

  // Primero una por partido; si se piden más que partidos, se completan.
  const two = drawRandom(pool, 2, rng(7));
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((x) => x.eventId).sort(), ['a', 'e']);
  const all = drawRandom(pool, 10, rng(7));
  assert.equal(all.length, 3, 'no hay más que las disponibles');
  assert.equal(new Set(all.map((x) => `${x.eventId}|${x.key}`)).size, 3, 'sin repetir');
  assert.ok(all.every((x, i) => i === 0 || all[i - 1].start <= x.start), 'ordenadas por hora');
  assert.deepEqual(drawRandom([], 5), []);
  // Al azar: con muchas apuestas, cada una sale más o menos igual de seguido.
  const big = Array.from({ length: 10 }, (_, i) => p(`m${i}`, 'OU|over|1.5', 'alta', later(1)));
  const counts = {};
  const r = rng(3);
  for (let i = 0; i < 4000; i++) for (const x of drawRandom(big, 3, r)) counts[x.eventId] = (counts[x.eventId] || 0) + 1;
  assert.ok(Object.values(counts).every((c) => c > 1000 && c < 1400), JSON.stringify(counts));
});

test('random bets: se siguen aparte y no se suman dos veces', async () => {
  const { RANDOM } = await import('../docs/js/history.js');
  const s = daySummary({
    analyses: [
      ...day.analyses,
      { id: 'r1', method: RANDOM, created: '2026-10-02T16:00:00Z', picks: [pick(1, '1X2|home|', 'alta', 'won', 1.4), pick(3, 'DC|1X|', 'moderada_alta', 'pending', 1.3)], combos: [] },
    ],
  });
  assert.equal(s.methods[RANDOM].n, 2);
  assert.equal(s.methods[RANDOM].won, 1);
  assert.equal(s.methods[RANDOM].byLevel.alta.won, 1);
  assert.equal(s.n, 4, 'la suma del día es la de los análisis estadístico y de red neuronal');
  assert.equal(s.pendingAll, 2, 'pero sus pendientes se liquidan');
  const t = totals({ days: { '2026-10-02': s } });
  assert.equal(t.methods[RANDOM].won, 1);
});
