import assert from 'node:assert/strict';
import test from 'node:test';
import { h2hData, parseH2H } from '../extension/sources/flashscore.js';
import { compactDay, compactResult, expandDay, expandResult } from '../docs/js/data-format.js';
import { settle } from '../docs/js/analysis/markets.js';

// Feed de H2H de Flashscore: registros separados por "~", campos por "¬" y
// clave/valor por "÷".
const rec = (fields) => Object.entries(fields).map(([k, v]) => `${k}÷${v}`).join('¬') + '¬~';
const row = (t, homeId, awayId, hs, as, wis) => rec({ KC: t, UQ: homeId, UO: awayId, KJ: homeId, KK: awayId, KU: hs, KT: as, WIS: wis });

// Local "A" y visita "B". A le ganó a B hace poco, así que esa fila aparece en
// las dos secciones de "Últimos partidos".
const FEED = [
  rec({ KA: 'General' }),
  rec({ KB: 'Últimos partidos: A' }),
  row(1000, 'A', 'B', 3, 0, 'w'),
  row(900, 'C', 'A', 1, 1, 'd'),
  row(800, 'A', 'D', 0, 2, 'l'),
  rec({ KB: 'Últimos partidos: B' }),
  row(1000, 'A', 'B', 3, 0, 'l'),
  row(950, 'B', 'E', 2, 1, 'w'),
  row(850, 'F', 'B', 0, 0, 'd'),
  row(750, 'B', 'G', 1, 0, 'w'),
  rec({ KB: 'Enfrentamientos' }),
  row(1000, 'A', 'B', 3, 0, ''),
  row(500, 'B', 'A', 2, 2, ''),
  row(400, 'B', 'A', 1, 0, ''),
  rec({ KA: 'Casa' }),
  rec({ KB: 'Últimos partidos: A' }),
  row(1000, 'X', 'Y', 9, 9, 'w'),
].join('');

test('H2H de Flashscore: cada equipo con su sección y balance de enfrentamientos', () => {
  const sections = parseH2H(FEED);
  assert.equal(sections.length, 3, 'solo se lee la pestaña General');
  const d = h2hData(sections, 'A', 'B');
  assert.deepEqual(
    d.lastHome.map((m) => [m.start, m.home, m.gf, m.ga, m.r]),
    [
      [1000000, true, 3, 0, 'W'],
      [900000, false, 1, 1, 'D'],
      [800000, true, 0, 2, 'L'],
    ],
  );
  assert.deepEqual(
    d.lastAway.map((m) => [m.start, m.home, m.gf, m.ga, m.r]),
    [
      [1000000, false, 0, 3, 'L'],
      [950000, true, 2, 1, 'W'],
      [850000, false, 0, 0, 'D'],
      [750000, true, 1, 0, 'W'],
    ],
  );
  assert.deepEqual(d.h2h, { homeWins: 1, draws: 1, awayWins: 1 });
});

test('H2H de Flashscore: sin sección propia no se inventan partidos', () => {
  const d = h2hData(parseH2H(FEED), 'A', 'Z');
  assert.equal(d.lastAway.length, 0);
});

const EVENT = {
  id: 'fs:abc123',
  source: 'flashscore',
  sport: 'football',
  start: Date.parse('2026-10-02T20:00:00Z'),
  tournament: { id: 'liga1', name: 'Liga 1', priority: 990 },
  category: { id: null, name: 'Perú', alpha2: 'PE' },
  home: { id: 'h1', name: 'Alianza Lima' },
  away: { id: 'a1', name: 'Sporting Cristal' },
  state: 'pendiente',
  score: null,
};

test('formato compacto: ida y vuelta de un día', () => {
  const offers = [
    { source: 'apuestatotal', market: '1X2', sel: 'home', line: null, price: 2.1 },
    { source: 'apuestatotal', market: 'OU', sel: 'over', line: 2.5, price: 1.95 },
    { source: 'apuestatotal', market: 'OU.corners@h1', sel: 'over', line: 4.5, price: 1.8, group: 'apuestatotal|Córners 1ra mitad|4.5' },
  ];
  const details = {
    teamStats: { home: { corners: { for: 5.5, against: 4.1, n: 8 } }, away: { corners: { for: 4, against: 6.25, n: 7 } } },
    lastHome: Array.from({ length: 12 }, (_, i) => ({ start: 1.7e12 - i * 864e5, home: i % 2 === 0, gf: 2, ga: 1, r: 'W', opp: 'X', league: 'L' })),
    lastAway: [],
    h2h: { homeWins: 2, draws: 1, awayWins: 0 },
  };
  const xg = { home: { team: 'A', xgFor: 1.23456, xgAgainst: 0.98765 }, away: { team: 'B', xgFor: 1.1, xgAgainst: 1.3 } };
  const raw = JSON.parse(
    JSON.stringify(compactDay({ date: '2026-10-02', sport: 'football', generated: 'g', events: [EVENT], offers: { [EVENT.id]: offers }, details: { [EVENT.id]: details }, xg: { [EVENT.id]: xg } })),
  );
  const day = expandDay(raw);
  const ev = day.events[0];
  assert.equal(ev.id, EVENT.id);
  assert.equal(ev.start, EVENT.start);
  assert.deepEqual(ev.tournament, EVENT.tournament);
  assert.equal(ev.category.alpha2, 'PE');
  assert.equal(ev.home.name, 'Alianza Lima');
  assert.equal(ev.url, 'https://www.flashscore.pe/partido/abc123/');
  assert.deepEqual(day.offers.get(EVENT.id), offers);
  const d = day.details.get(EVENT.id);
  assert.equal(d.lastHome.length, 10, 'se guardan los últimos 10');
  assert.deepEqual(d.lastHome[1], { start: 1.7e12 - 864e5, home: false, gf: 2, ga: 1, r: 'W' });
  assert.deepEqual(d.h2h, details.h2h);
  assert.deepEqual(d.teamStats, details.teamStats);
  assert.deepEqual(day.xg.get(EVENT.id), { home: { xgFor: 1.235, xgAgainst: 0.988 }, away: { xgFor: 1.1, xgAgainst: 1.3 } });
});

test('formato compacto: resultados que liquidan apuestas', () => {
  const done = expandResult(JSON.parse(JSON.stringify(compactResult({ ...EVENT, state: 'finalizado', score: { home: 2, away: 1 } }))));
  assert.equal(settle({ market: '1X2', sel: 'home', line: null }, done, 'football'), 'won');
  assert.equal(settle({ market: 'OU', sel: 'under', line: 2.5 }, done, 'football'), 'lost');
  const postponed = expandResult(compactResult({ ...EVENT, state: 'aplazado', score: null }));
  assert.equal(settle({ market: '1X2', sel: 'home', line: null }, { ...postponed, final: true }, 'football'), 'void');
  // Con los periodos del feed del día se liquidan mitades; con el registro, córners.
  const fin = { ...EVENT, state: 'finalizado', score: { home: 2, away: 1 } };
  const per = expandResult(JSON.parse(JSON.stringify(compactResult(fin, { per: [[0, 1], [2, 0]] }))));
  assert.equal(settle({ market: '1X2@h1', sel: 'away', line: null }, per, 'football'), 'won');
  assert.equal(settle({ market: 'OU.corners', sel: 'over', line: 8.5 }, per, 'football'), null);
  const record = { sport: 'football', state: 'finalizado', per: [[0, 1], [2, 0]], nReg: 2, final: [2, 1], stats: { corners: { ft: [7, 3] } }, events: [{ k: 'goal', team: 'away', min: 10.5 }] };
  const full = expandResult(JSON.parse(JSON.stringify(compactResult(fin, { per: record.per, record }))), 'football');
  assert.equal(settle({ market: 'OU.corners', sel: 'over', line: 8.5 }, full, 'football'), 'won');
  assert.equal(settle({ market: 'FIRST', sel: 'away', line: null }, full, 'football'), 'won');
  assert.equal(settle({ market: 'COMEBACK:home', sel: 'yes', line: null }, full, 'football'), 'won');
});
