// Props de jugador de básquet: catálogo, modelo, picks y liquidación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { labelOf, parseMarket, parseMarketId, playerSlug, playerValue } from '../docs/js/analysis/catalog.js';
import { evaluate } from '../docs/js/analysis/outcomes.js';
import { marketProbabilities, offersFromApuestaTotal, settle } from '../docs/js/analysis/markets.js';
import { boxesFor, findPlayer, overProb, playerProbability, playersFor, resultOf, teamLogs } from '../docs/js/analysis/players.js';
import { selectPicks } from '../docs/js/analysis/picks.js';
import { compactOffers, expandOffers } from '../docs/js/data-format.js';

const ctx = { sport: 'basketball', home: 'New York Knicks', away: 'Miami Heat' };
const sig = (r) => r?.outcomes?.map((o) => `${o.market}|${o.sel}|${o.line}`) || r?.unsupported || null;

test('Apuesta Total: el jugador va en cada selección', () => {
  const r = parseMarket('Puntos del jugador (incl. prórroga)', [
    { name: 'Mikal Bridges Menos de 12.5', price: 1.67, line: -1250 },
    { name: 'Mikal Bridges Más de 12.5', price: 1.86, line: 1250 },
    { name: 'Pelle Larsson Más de 9.5', price: 1.74 },
  ], ctx);
  assert.deepEqual(sig(r), ['PL.pts#mikal_bridges|under|12.5', 'PL.pts#mikal_bridges|over|12.5', 'PL.pts#pelle_larsson|over|9.5']);
  assert.deepEqual(sig(parseMarket('Doble-Doble del jugador (incl. Prórroga)', [{ name: 'Karl-Anthony Towns - Sí', price: 1.17 }, { name: 'Karl-Anthony Towns - No', price: 3.52 }], ctx)), [
    'PL.dd#karl-anthony_towns|over|0.5',
    'PL.dd#karl-anthony_towns|under|0.5',
  ]);
  assert.deepEqual(sig(parseMarket('Jugador: Total de puntos, asistencias y rebotes', [{ name: 'Giannis Antetokounmpo Más de 43.5', price: 1.7 }], ctx)), ['PL.pra#giannis_antetokounmpo|over|43.5']);
  assert.deepEqual(sig(parseMarket('Tiros de 3 puntos anotados por jugador (incl. Prórroga)', [{ name: 'Josh Hart Más de 1.5', price: 2 }], ctx)), ['PL.threes#josh_hart|over|1.5']);
  assert.deepEqual(sig(parseMarket('Asistencias y rebotes del jugador (incl. Prórroga)', [{ name: 'Jalen Brunson Menos de 9.5', price: 1.8 }], ctx)), ['PL.ra#jalen_brunson|under|9.5']);
  assert.deepEqual(sig(parseMarket('Puntos y asistencias del jugador (incl. Prórroga)', [{ name: 'Jalen Brunson Más de 30.5', price: 1.8 }], ctx)), ['PL.pa#jalen_brunson|over|30.5']);
  assert.deepEqual(sig(parseMarket('Puntos y rebotes del jugador (incl. Prórroga)', [{ name: 'Jalen Brunson Más de 30.5', price: 1.8 }], ctx)), ['PL.pr#jalen_brunson|over|30.5']);
});

test('Betano: el jugador va en el nombre del mercado', () => {
  const ou = [{ name: 'Más de 5.5', price: 1.85 }, { name: 'Menos de 5.5', price: 1.9 }];
  assert.deepEqual(sig(parseMarket('Total de Puntos LeBron James', ou, ctx)), ['PL.pts#lebron_james|over|5.5', 'PL.pts#lebron_james|under|5.5']);
  assert.equal(sig(parseMarket('Total de tiros de 2 puntos anotados Jalen Brunson', ou, ctx))[0], 'PL.twos#jalen_brunson|over|5.5');
  assert.equal(sig(parseMarket('Total de tiros de 2 puntos intentados Jalen Brunson', ou, ctx))[0], 'PL.twos_a#jalen_brunson|over|5.5');
  assert.equal(sig(parseMarket('Total de tiros libres anotados Jalen Brunson', ou, ctx))[0], 'PL.ftm#jalen_brunson|over|5.5');
  assert.equal(sig(parseMarket('Total de tiros libres intentados Jalen Brunson', ou, ctx))[0], 'PL.fta#jalen_brunson|over|5.5');
  assert.equal(sig(parseMarket('Luka Dončić Total de Puntos, Rebotes y Asistencias', ou, ctx))[0], 'PL.pra#luka_doncic|over|5.5');
  assert.equal(sig(parseMarket('Double-double Nikola Jokić', [{ name: 'Sí', price: 1.2 }, { name: 'No', price: 4 }], ctx))[0], 'PL.dd#nikola_jokic|over|0.5');
  // Lo que no se pidió o no tiene datos queda sin analizar.
  assert.equal(sig(parseMarket('Total de Rebotes Ofensivos Nikola Jokić', ou, ctx)), 'player');
  assert.equal(sig(parseMarket('Robos del jugador (incl. Prórroga)', [{ name: 'Bam Adebayo Más de 1.5', price: 1.69 }], ctx)), 'player');
  assert.equal(sig(parseMarket('Total de Puntos H2H LeBron James', [{ name: 'LeBron James', price: 1.8 }], ctx)), 'player');
  assert.equal(sig(parseMarket('Más puntos en el partido', [{ name: 'LeBron James', price: 3 }], ctx)), 'player');
});

test('los mercados de equipo no se confunden con los de jugador', () => {
  const ou = [{ name: 'Más de 108.5', price: 1.8 }, { name: 'Menos de 108.5', price: 1.9 }];
  assert.equal(sig(parseMarket('Miami Heat: Total de puntos', ou, ctx))[0], 'OU:away|over|108.5');
  assert.equal(sig(parseMarket('Total de puntos (incl. prórroga)', ou, ctx))[0], 'OU|over|108.5');
  assert.equal(sig(parseMarket('1er Cuarto Total Puntos', ou, ctx))[0], 'OU@p1|over|108.5');
  assert.equal(sig(parseMarket('Total de rebotes', ou, ctx))[0], 'OU.reb|over|108.5');
  // En fútbol no hay mercados de jugador.
  assert.equal(sig(parseMarket('Anotar en cualquier momento', [{ name: 'Lionel Messi', price: 2 }], { sport: 'football', home: 'A', away: 'B' })), 'player');
});

test('etiquetas, valores y nombres', () => {
  assert.equal(labelOf('PL.pra#luka_doncic', 'over', 48.5, 'basketball', { player: 'Luka Dončić' }), 'Luka Dončić: Más de 48.5 puntos, rebotes y asistencias');
  assert.equal(labelOf('PL.dd#karl-anthony_towns', 'under', 0.5, 'basketball'), 'Karl-Anthony Towns: double-double No');
  assert.equal(playerSlug('Jaren Jackson Jr.'), 'jaren_jackson');
  // [min, pts, reb, ast, 3pm, 3pa, fgm, fga, ftm, fta]
  const box = [34, 28, 11, 4, 3, 8, 10, 20, 5, 7];
  assert.equal(playerValue(box, 'pra'), 43);
  assert.equal(playerValue(box, 'twos'), 7);
  assert.equal(playerValue(box, 'twos_a'), 12);
  assert.equal(playerValue(box, 'fta'), 7);
  assert.equal(playerValue(box, 'dd'), 1);
  assert.equal(playerValue([30, 9, 12, 9, 0, 0, 4, 9, 1, 2], 'dd'), 0);
  assert.equal(findPlayer('j_brunson', { jalen_brunson: [1] })?.key, 'jalen_brunson');
});

test('probabilidad: más/menos y línea entera', () => {
  assert.ok(Math.abs(overProb(20, 60, 19.5) - 0.5) < 0.08);
  assert.ok(overProb(20, 60, 10.5) > 0.9);
  assert.ok(overProb(2, 2.5, 4.5) < 0.15);
  // Con línea entera no cuenta el empate (se devuelve la apuesta).
  const p = overProb(10, 15, 10);
  assert.ok(p > 0.4 && p < 0.6, String(p));
});

// Datos de ejemplo: 10 partidos de los Knicks con Brunson ~27 puntos.
const DAY = 86400000;
function sample({ injury = '' } = {}) {
  const start = Date.parse('2026-11-27T00:00:00Z');
  const games = [];
  for (let i = 1; i <= 10; i++) {
    games.push({
      id: `g${i}`,
      start: start - i * 2 * DAY,
      state: 'finalizado',
      home: { id: '18', name: 'New York Knicks', abbr: 'NY' },
      away: { id: '5', name: 'Cleveland Cavaliers', abbr: 'CLE' },
      score: [110, 100],
      players: [
        ['Jalen Brunson', 0, 35, 24 + (i % 5) * 2, 3, 7, 3, 8, 9, 20, 3, 4],
        ['Karl-Anthony Towns', 0, 33, 22, 12, 3, 2, 5, 8, 16, 4, 5],
        ['Donovan Mitchell', 1, 34, 25, 4, 5, 3, 8, 9, 19, 4, 5],
      ],
    });
  }
  const data = {
    games: [{ id: 'next', start, home: { id: '18', name: 'New York Knicks', abbr: 'NY' }, away: { id: '14', name: 'Miami Heat', abbr: 'MIA' }, injuries: injury ? { jalen_brunson: injury } : {} }],
    teams: { 18: teamLogs('18', games) },
  };
  return { start, data, games };
}

test('modelo del jugador con sus últimos partidos', () => {
  const { start, data } = sample();
  const ev = { sport: 'basketball', start, home: { name: 'New York Knicks' }, away: { name: 'Miami Heat' } };
  const info = playersFor(ev, data);
  assert.ok(info?.home, 'encuentra el partido y el equipo');
  const over = playerProbability(parseMarketId('PL.pts#jalen_brunson'), 'over', 20.5, info);
  assert.ok(over.p > 0.75, String(over.p));
  assert.match(over.factors[0], /Jalen Brunson \(NY\): 2\d(\.\d)? puntos por partido en sus últimos 10/);
  const under = playerProbability(parseMarketId('PL.pts#jalen_brunson'), 'under', 20.5, info);
  assert.ok(Math.abs(over.p + under.p - 1) < 1e-9);
  const dd = playerProbability(parseMarketId('PL.dd#karl-anthony_towns'), 'over', 0.5, info);
  assert.ok(dd.p > 0.85, String(dd.p));
  assert.equal(playerProbability(parseMarketId('PL.pts#nadie_mas'), 'over', 5.5, info), null, 'sin datos del jugador');
  // Lesionado: si está fuera no se recomienda; si es duda, menos confianza.
  assert.equal(playerProbability(parseMarketId('PL.pts#jalen_brunson'), 'over', 20.5, playersFor(ev, sample({ injury: 'Out' }).data)), null);
  const doubt = playerProbability(parseMarketId('PL.pts#jalen_brunson'), 'over', 20.5, playersFor(ev, sample({ injury: 'Day-To-Day' }).data));
  assert.ok(doubt.quality < over.quality && /Day-To-Day/.test(doubt.factors.join(' ')));
});

test('margen de la casa por jugador y línea', () => {
  const at = { home: 'New York Knicks', away: 'Miami Heat' };
  const markets = [
    {
      name: 'Puntos del jugador (incl. prórroga)',
      selections: [
        { name: 'Jalen Brunson Más de 26.5', price: 1.85 },
        { name: 'Jalen Brunson Menos de 26.5', price: 1.85 },
        { name: 'Josh Hart Más de 26.5', price: 5 },
        { name: 'Josh Hart Menos de 26.5', price: 1.1 },
      ],
    },
  ];
  const offers = offersFromApuestaTotal(markets, at, { sport: 'basketball', home: { name: at.home }, away: { name: at.away } });
  assert.equal(offers[0].player, 'Jalen Brunson');
  const pm = marketProbabilities(offers);
  assert.ok(Math.abs(pm.get('PL.pts#jalen_brunson|over|26.5') - 0.5) < 1e-9);
  assert.ok(pm.get('PL.pts#josh_hart|over|26.5') < 0.25);
  // El nombre del jugador se conserva en las cuotas publicadas.
  assert.equal(expandOffers(compactOffers(offers))[0].player, 'Jalen Brunson');
});

test('los picks de jugador salen además del pick del partido', () => {
  const base = { eventId: 'e1', best: { price: 1.8, source: 'apuestatotal' } };
  const cands = [
    { ...base, key: 'a', market: 'ML', family: 'resultado', p: 0.82 },
    { ...base, key: 'b', market: 'PL.pts#jalen_brunson', family: 'jugador', p: 0.85 },
  ];
  const picks = selectPicks(cands);
  assert.deepEqual(picks.map((p) => p.key).sort(), ['a', 'b']);
  assert.deepEqual(selectPicks(cands, { ...selectPicksDefaults(), marketGroups: ['principales'] }).map((p) => p.key), ['a']);
});
const selectPicksDefaults = () => ({ alta: 0.8, moderadaAlta: 0.7, moderada: 0.6, minOdds: 1.15 });

test('liquidación con la ficha del partido', () => {
  const { games } = sample();
  const results = games.map((g) => resultOf(g));
  const g = games[0];
  const leg = { match: 'New York Knicks vs Cleveland Cavaliers', start: g.start + 5 * 60000, sport: 'basketball' };
  const box = boxesFor(leg, results);
  assert.ok(box, 'encuentra el partido');
  const res = { state: 'finalizado', score: { home: 110, away: 100 }, players: box.p };
  const brunson = playerValue(box.p.jalen_brunson, 'pts');
  assert.equal(settle({ ...leg, market: 'PL.pts#jalen_brunson', sel: 'over', line: brunson - 0.5 }, res, 'basketball'), 'won');
  assert.equal(settle({ ...leg, market: 'PL.pts#jalen_brunson', sel: 'over', line: brunson + 0.5 }, res, 'basketball'), 'lost');
  assert.equal(settle({ ...leg, market: 'PL.pts#jalen_brunson', sel: 'over', line: brunson }, res, 'basketball'), 'void');
  assert.equal(settle({ ...leg, market: 'PL.dd#karl-anthony_towns', sel: 'over', line: 0.5 }, res, 'basketball'), 'won');
  // No jugó (no está en la ficha o con 0 minutos): nula.
  assert.equal(settle({ ...leg, market: 'PL.pts#otro_jugador', sel: 'over', line: 5.5 }, res, 'basketball'), 'void');
  assert.equal(evaluate('PL.pts#banca_total', 'over', 5.5, { sport: 'basketball', state: 'finalizado', players: { banca_total: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], x_y: [1] } }), 'void');
  // Sin fichas todavía: se espera.
  assert.equal(settle({ ...leg, market: 'PL.pts#jalen_brunson', sel: 'over', line: 5.5 }, { state: 'finalizado', score: { home: 1, away: 0 } }, 'basketball'), null);
});
