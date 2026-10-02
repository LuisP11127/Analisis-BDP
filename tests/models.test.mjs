import assert from 'node:assert/strict';
import test from 'node:test';
import { goalsModel, pointsModel, scoreMatrix, scoreOutcomes, teamForm, tennisModel } from '../docs/js/analysis/models.js';
import { sportOf } from '../docs/js/sports.js';

// Últimos partidos de prueba: gf/ga por partido, alternando local/visitante.
const history = (pairs) =>
  pairs.map(([gf, ga], i) => ({ start: 1e12 - i * 864e5, home: i % 2 === 0, gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D' }));

const strong = history([[3, 0], [2, 1], [2, 0], [4, 1], [1, 1], [3, 1], [2, 0], [2, 2], [3, 0], [1, 0]]);
const weak = history([[0, 2], [1, 3], [0, 1], [1, 1], [0, 2], [1, 2], [0, 0], [0, 3], [1, 2], [0, 1]]);
const ev = (sport) => ({ id: 1, sport, start: 2e12, home: { name: 'A' }, away: { name: 'B' } });

test('la matriz de marcadores suma 1 y los resultados son coherentes', () => {
  const o = scoreOutcomes(scoreMatrix(1.6, 1.1, { dixonColes: true }));
  assert.ok(Math.abs(o.home + o.draw + o.away - 1) < 1e-9);
  assert.ok(o.home > o.away);
  assert.ok(o.over(0.5) > o.over(1.5) && o.over(1.5) > o.over(2.5));
  assert.ok(o.btts > 0 && o.btts < 1);
  assert.ok(Math.abs(o.handicap(-0.5) - o.home) < 1e-9, 'hándicap -0.5 = gana local');
});

test('la forma pondera más lo reciente', () => {
  const f = teamForm(strong);
  assert.equal(f.n, 10);
  assert.ok(f.gf > f.ga);
  assert.deepEqual(f.last5, ['W', 'W', 'W', 'W', 'D']);
});

test('fútbol: el equipo fuerte es favorito y aparecen todos los mercados', () => {
  const m = goalsModel(ev('football'), { lastHome: strong, lastAway: weak }, sportOf('football'), { lines: { OU: [2.5], HCP: [] } });
  const get = (market, sel, line = null) => m.candidates.find((c) => c.market === market && c.sel === sel && c.line === line).p;
  assert.ok(get('1X2', 'home') > 0.6, `local fuerte: ${get('1X2', 'home')}`);
  assert.ok(Math.abs(get('1X2', 'home') + get('1X2', 'draw') + get('1X2', 'away') - 1) < 1e-6);
  assert.ok(get('DC', '1X') > get('1X2', 'home'));
  assert.ok(Math.abs(get('OU', 'over', 2.5) + get('OU', 'under', 2.5) - 1) < 1e-6);
  assert.ok(m.candidates.some((c) => c.market === 'BTTS'));
  // Invertido, el favorito cambia.
  const r = goalsModel(ev('football'), { lastHome: weak, lastAway: strong }, sportOf('football'), { lines: { OU: [], HCP: [] } });
  assert.ok(r.candidates.find((c) => c.market === '1X2' && c.sel === 'away').p > 0.5);
});

test('xG de Understat modifica los goles esperados', () => {
  const base = goalsModel(ev('football'), { lastHome: strong, lastAway: weak }, sportOf('football'), {});
  const xg = goalsModel(ev('football'), { lastHome: strong, lastAway: weak }, sportOf('football'), {
    xg: { home: { xgFor: 1.0, xgAgainst: 1.5 }, away: { xgFor: 1.8, xgAgainst: 0.9 } },
  });
  assert.ok(xg.expected.home < base.expected.home);
  assert.ok(xg.expected.xg);
});

test('hockey y béisbol: ganador sin empate', () => {
  const m = goalsModel(ev('ice-hockey'), { lastHome: strong, lastAway: weak }, sportOf('ice-hockey'), {});
  const ml = m.candidates.filter((c) => c.market === 'ML');
  assert.equal(ml.length, 2);
  assert.ok(Math.abs(ml[0].p + ml[1].p - 1) < 1e-6);
  assert.ok(!m.candidates.some((c) => c.market === '1X2'));
});

test('básquet: margen y total con líneas de la casa', () => {
  const pts = (pairs) => history(pairs);
  const home = pts([[112, 100], [108, 101], [115, 109], [99, 104], [120, 110], [111, 103], [105, 98], [117, 108], [102, 99], [109, 100]]);
  const away = pts([[98, 110], [101, 105], [95, 108], [104, 102], [99, 111], [100, 107], [97, 103], [103, 109], [96, 101], [101, 106]]);
  const m = pointsModel(ev('basketball'), { lastHome: home, lastAway: away }, sportOf('basketball'), { lines: { OU: [210.5], HCP: [-6.5] } });
  const get = (market, sel, line = null) => m.candidates.find((c) => c.market === market && c.sel === sel && c.line === line).p;
  assert.ok(get('ML', 'home') > 0.7);
  assert.ok(get('HCP', 'home', -6.5) < get('ML', 'home'));
  assert.ok(Math.abs(get('OU', 'over', 210.5) + get('OU', 'under', 210.5) - 1) < 1e-6);
});

test('tenis: el ranking pesa', () => {
  const e = { ...ev('tennis'), home: { name: 'A', ranking: 5 }, away: { name: 'B', ranking: 120 } };
  const m = tennisModel(e, { lastHome: [], lastAway: [] }, sportOf('tennis'));
  assert.ok(m.candidates.find((c) => c.sel === 'home').p > 0.85);
});

test('sin datos no hay modelo', () => {
  assert.equal(goalsModel(ev('football'), { lastHome: [], lastAway: weak }, sportOf('football'), {}), null);
});
