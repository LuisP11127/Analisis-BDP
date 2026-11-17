import assert from 'node:assert/strict';
import test from 'node:test';
import { daySummary, randomCandidates, totals } from '../docs/js/history.js';
import { SEL_GENERAL, SEL_LADO, buildSelector, inverseOf, qualifying, ruleFor, selectorAnalyses, sideKey } from '../docs/js/selector.js';
import { evaluate } from '../docs/js/analysis/outcomes.js';

const st = (won, lost) => ({ n: won + lost, won, lost, void: 0, pending: 0, profit: 0, staked: won + lost });

test('lado de cada selección', () => {
  assert.equal(sideKey('over'), 'over');
  assert.equal(sideKey('X2'), 'X2');
  assert.equal(sideKey('home'), 'home');
  assert.equal(sideKey('2-1'), 'otro');
  assert.equal(sideKey('!1X2~home~+OU~over~2.5'), 'otro');
});

test('inversa: más ↔ menos, local ↔ visitante y doble oportunidad', () => {
  assert.deepEqual(inverseOf('OU', 'over', 2.5), { market: 'OU', sel: 'under', line: 2.5 });
  assert.deepEqual(inverseOf('OU.corners@h1', 'under', 4.5), { market: 'OU.corners@h1', sel: 'over', line: 4.5 });
  assert.deepEqual(inverseOf('HCP', 'home', -1.5), { market: 'HCP', sel: 'away', line: -1.5 });
  assert.deepEqual(inverseOf('1X2', 'home', null), { market: '1X2', sel: 'away', line: null });
  assert.deepEqual(inverseOf('BTTS', 'yes', null), { market: 'BTTS', sel: 'no', line: null });
  assert.deepEqual(inverseOf('DC', '1X', null), { market: '1X2', sel: 'away', line: null });
  assert.deepEqual(inverseOf('DC@h1', 'X2', null), { market: '1X2@h1', sel: 'home', line: null });
  assert.deepEqual(inverseOf('1X2', 'draw', null), { market: 'DC', sel: '12', line: null });
  assert.equal(inverseOf('CS', '2-1', null), null);
  // El hándicap del visitante con la misma línea (la del local) es el lado contrario.
  const rec = { state: 'finalizado', final: [1, 0] };
  assert.equal(evaluate('HCP', 'home', -1.5, rec), 'lost');
  assert.equal(evaluate('HCP', 'away', -1.5, rec), 'won');
});

test('regla: 10 resueltas, 67% o más directa, 33% o menos inversa', () => {
  assert.equal(ruleFor(st(9, 0)), null, 'menos de 10 resueltas');
  assert.equal(ruleFor(st(8, 2)), 'directa');
  assert.equal(ruleFor(st(2, 1)), null);
  assert.equal(ruleFor(st(20, 10)), 'directa', '66,7% se ve como 67%');
  assert.equal(ruleFor(st(6, 6)), null);
  assert.equal(ruleFor(st(4, 11)), 'inversa', '27%');
  assert.equal(ruleFor(st(5, 10)), 'inversa', '33,3% se ve como 33%');
  assert.equal(ruleFor(st(7, 13)), null, '35%');
});

// Totales de "Por deporte" de un método.
const methodTotals = (bySportLeagueMarket, bySportLeagueSide) => ({ bySportLeagueMarket, bySportLeagueSide });
const LEAGUE = 'MLS|Estados Unidos';
const EURO = 'Eurocup|Europa';

const events = {
  1: { id: 1, sport: 'football', league: 'MLS', country: 'Estados Unidos', home: 'A', away: 'B' },
  2: { id: 2, sport: 'basketball', league: 'Eurocup', country: 'Europa', home: 'C', away: 'D' },
};
const cand = (eventId, sport, market, sel, line, p, price, extra = {}) => ({
  eventId,
  sport,
  start: 1000 + eventId,
  key: `${market}|${sel}|${line ?? ''}`,
  market,
  sel,
  line,
  label: `${market} ${sel} ${line ?? ''}`.trim(),
  p,
  ev: p * price - 1,
  best: { price, source: 'betano' },
  level: 'alta',
  ...extra,
});

test('selector: directas, inversas, sin picks de valor y "Est + Red Neu"', () => {
  const over = cand(1, 'football', 'OU', 'over', 2.5, 0.82, 1.2); // ev < 0
  const valor = cand(1, 'football', 'BTTS', 'yes', null, 0.8, 1.5); // ev 0.2: tiene valor, no entra
  const hcp = cand(2, 'basketball', 'HCP', 'home', -4.5, 0.7, 1.4); // ev -0.02
  const hcpAway = cand(2, 'basketball', 'HCP', 'away', -4.5, 0.3, 2.6);
  const result = (method, picks) => ({ method, created: '2026-11-17T10:00:00Z', run: '2026-11-17T10:00:00Z', date: '2026-11-17', events, picks, candidates: [over, valor, hcp, hcpAway] });
  const est = methodTotals(
    { football: { [LEAGUE]: { total: st(88, 22), ambos: st(20, 2) } }, basketball: { [EURO]: { handicap: st(4, 11) } } },
    { football: { [LEAGUE]: { total: { over: st(5, 5) } } }, basketball: { [EURO]: { handicap: { home: st(3, 7) } } } },
  );
  const rn = methodTotals({ football: { [LEAGUE]: { total: st(9, 1) } } }, {});
  const sel = buildSelector({ estadistico: result('estadistico', [over, valor, hcp]), red_neuronal: result('red_neuronal', [over]) }, { estadistico: est, red_neuronal: rn });

  const g = sel[SEL_GENERAL];
  assert.equal(g.length, 2, 'el pick de valor no entra');
  const ou = g.find((p) => p.market === 'OU');
  assert.deepEqual(ou.methods, ['estadistico', 'red_neuronal']);
  assert.equal(ou.inverse, false);
  assert.equal(ou.rules.length, 2);
  const inv = g.find((p) => p.eventId === 2);
  assert.equal(inv.inverse, true);
  assert.equal(inv.sel, 'away');
  assert.equal(inv.line, -4.5);
  assert.equal(inv.odds, 2.6, 'cuota de la inversa');
  assert.equal(inv.orig.sel, 'home');
  assert.deepEqual(inv.methods, ['estadistico']);

  // Por lado: Más (50%) no cumple; hándicap local (30%) va a la inversa.
  const l = sel[SEL_LADO];
  assert.equal(l.length, 1);
  assert.equal(l[0].inverse, true);
  assert.equal(l[0].side, 'home');

  const saved = selectorAnalyses(sel);
  assert.deepEqual(saved.map((a) => a.method), [SEL_GENERAL, SEL_LADO]);
  assert.deepEqual(Object.keys(saved[1].events), ['2']);

  const q = qualifying({ estadistico: est, red_neuronal: rn });
  assert.equal(q.filter((x) => x.section === SEL_GENERAL).length, 4);
  assert.equal(q.filter((x) => x.section === SEL_LADO).length, 1);
});

test('resumen: lados por liga y mercado; el selector no se suma ni entra al sorteo', () => {
  const pick = (eventId, market, sel, status, extra = {}) => ({ eventId, sport: 'football', key: `${market}|${sel}|2.5`, market, sel, line: 2.5, level: 'alta', status, odds: 1.8, start: 9e15, ...extra });
  const day = {
    date: '2026-11-17',
    analyses: [
      { id: 'est', method: 'estadistico', created: 'a', events, picks: [pick(1, 'OU', 'over', 'won'), pick(1, 'OU', 'under', 'lost'), pick(3, 'OU', 'over', 'pending')], combos: [] },
      {
        id: 'sel',
        method: SEL_GENERAL,
        created: 'b',
        events,
        picks: [pick(1, 'OU', 'under', 'won', { inverse: true, odds: null }), pick(3, 'OU', 'over', 'pending')],
        combos: [],
      },
    ],
  };
  const s = daySummary(day);
  const m = s.methods.estadistico;
  assert.equal(m.bySportLeagueSide.football[LEAGUE].total.over.won, 1);
  assert.equal(m.bySportLeagueSide.football[LEAGUE].total.under.lost, 1);
  assert.equal(s.n, 3, 'el selector no se suma al total');
  assert.equal(s.pendingAll, 2, 'pero sus pendientes sí cuentan para liquidarlas');
  const sm = s.methods[SEL_GENERAL];
  assert.equal(sm.byKind.inversa.won, 1);
  assert.equal(sm.profit, 0, 'sin cuota no suma ganancia');
  assert.equal(sm.staked, 0);
  const t = totals({ days: { a: s, b: s } });
  assert.equal(t.methods.estadistico.bySportLeagueSide.football[LEAGUE].total.over.won, 2);
  assert.equal(t.methods[SEL_GENERAL].byKind.inversa.won, 2);
  const pool = randomCandidates(day, 0);
  assert.equal(pool.length, 1);
  assert.deepEqual(pool[0].methods, ['estadistico']);
});
