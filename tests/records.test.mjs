import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { evaluate } from '../docs/js/analysis/outcomes.js';
import {
  compactRecord,
  expandRecord,
  mergeRecords,
  minuteOf,
  parseFsGames,
  parseFsIncidents,
  parseFsStats,
  periodsFromRow,
  recordFromFlashscore,
  recordFromSofascore,
} from '../docs/js/analysis/records.js';

// Feeds reales de Flashscore (2 oct 2026), algunos recortados.
const read = (n) => {
  try {
    return fs.readFileSync(new URL(`./fixtures/flashscore/${n}`, import.meta.url), 'utf8');
  } catch {
    return null;
  }
};
function fsRecord(name, sport) {
  const row = JSON.parse(read(`${name}-fila.json`));
  const sui = read(`${name}-sui.txt`);
  const st = read(`${name}-st.txt`);
  const mh = read(`${name}-mh.txt`);
  const rec = recordFromFlashscore({
    sport,
    state: 'finalizado',
    final: [Number(row.AG), Number(row.AH)],
    per: periodsFromRow(row, sport),
    incidents: sui ? parseFsIncidents(sui, sport) : null,
    stats: st ? parseFsStats(st, sport) : null,
    games: mh && sport === 'tennis' ? parseFsGames(mh) : null,
  });
  // Lo que se publica es el formato compacto: se prueba ya expandido.
  return expandRecord(JSON.parse(JSON.stringify(compactRecord(rec))), sport, 'finalizado');
}
const ev = (rec) => (m, s, l = null) => evaluate(m, s, l, rec);

test('minutos de Flashscore', () => {
  assert.equal(minuteOf("21'"), 20.5);
  assert.equal(minuteOf("45+2'"), 44.99);
  assert.equal(minuteOf("90+3'"), 89.99);
  assert.equal(minuteOf('12:29', { perIndex: 1, perMinutes: 20 }), 20 + 12 + 29 / 60);
});

test('fútbol: goles con minuto, autogol, tarjetas y primer tiempo deducido de la fila', () => {
  // Koge 5-1 Servette: 3-0 al descanso (con un autogol de Servette a los 35').
  const e = ev(fsRecord('futbol2', 'football'));
  assert.equal(e('1X2@h1', 'home'), 'won');
  assert.equal(e('OU@h1', 'over', 2.5), 'won');
  assert.equal(e('FIRST', 'home'), 'won');
  assert.equal(e('AND', '1X2@h1~home~+1X2~home~'), 'won');
  assert.equal(e('OU@m0-30', 'over', 1.5), 'won', 'dos goles antes del 30');
  assert.equal(e('LAST', 'home'), 'won');
  assert.equal(e('BTTS', 'yes'), 'won');
  // Austria Viena 1-1 Inter: el empate llegó en el descuento.
  const e2 = ev(fsRecord('futbol', 'football'));
  assert.equal(e2('1X2', 'draw'), 'won');
  assert.equal(e2('LAST', 'away'), 'won');
  assert.equal(e2('FGT', '0-30'), 'won', 'primer gol a los 21');
});

test('fútbol: estadísticas por tiempo (córners, rojas)', () => {
  const e = ev(fsRecord('futbol-reserva', 'football'));
  assert.equal(e('OU.corners', 'over', 6.5), 'won');
  assert.equal(e('OU.corners@h1:away', 'over', 1.5), 'won');
  assert.equal(e('1X2.corners', 'home'), 'won');
  assert.equal(e('OU.reds', 'over', 0.5), 'won');
  assert.equal(e('OU.shots_on', 'under', 0.5), 'won');
});

test('básquet, tenis, hockey y béisbol', () => {
  const b = ev(fsRecord('basquet', 'basketball'));
  assert.equal(b('ML', 'away'), 'won');
  assert.equal(b('1X2@p1', 'away'), 'won');
  assert.equal(b('OU@h1', 'over', 80.5), 'won', '41-40 en la 1.ª mitad');
  assert.equal(b('OU.reb', 'over', 80.5), 'won', '37 + 45 rebotes');
  assert.equal(b('OU.threes:away', 'over', 9.5), 'won');

  const t = ev(fsRecord('tenis', 'tennis'));
  assert.equal(t('CS', '2-1'), 'won');
  assert.equal(t('ML@s1', 'away'), 'won');
  assert.equal(t('OU.games', 'over', 22.5), 'won', '33 juegos');
  assert.equal(t('OU.aces', 'over', 5.5), 'won');
  assert.equal(t('OU.tiebreaks', 'over', 0.5), 'lost');

  const h = ev(fsRecord('hockey', 'ice-hockey'));
  assert.equal(h('1X2@reg', 'home'), 'won');
  assert.equal(h('OU@p1', 'over', 1.5), 'won');
  assert.equal(h('FIRST', 'home'), 'won');

  const bb = ev(fsRecord('beisbol', 'baseball'));
  assert.equal(bb('ML', 'home'), 'won');
  assert.equal(bb('OU@i1-5', 'over', 8.5), 'won', '6 + 3 carreras en 5 entradas');
  assert.equal(bb('OU.hits', 'over', 16.5), 'won');
});

// Sofascore: estructura de /event/{id}, /statistics e /incidents.
const SOFA = {
  event: {
    status: { type: 'finished' },
    homeScore: { current: 2, period1: 0, period2: 2, normaltime: 2 },
    awayScore: { current: 1, period1: 1, period2: 0, normaltime: 1 },
    winnerCode: 1,
  },
  statistics: {
    statistics: [
      { period: 'ALL', groups: [{ statisticsItems: [{ key: 'cornerKicks', homeValue: 7, awayValue: 2 }, { key: 'yellowCards', homeValue: 2, awayValue: 3 }] }] },
      { period: '1ST', groups: [{ statisticsItems: [{ key: 'cornerKicks', homeValue: 3, awayValue: 1 }] }] },
    ],
  },
  incidents: {
    incidents: [
      { incidentType: 'goal', isHome: false, time: 12, incidentClass: 'regular' },
      { incidentType: 'card', isHome: true, time: 30, incidentClass: 'yellow' },
      { incidentType: 'goal', isHome: true, time: 61, incidentClass: 'penalty' },
      { incidentType: 'goal', isHome: false, time: 88, incidentClass: 'ownGoal' },
    ],
  },
};

test('registro de Sofascore y unión con el de Flashscore', () => {
  const rec = recordFromSofascore({ sport: 'football', ...SOFA });
  const e = ev(rec);
  assert.equal(e('COMEBACK:home', 'yes'), 'won');
  assert.equal(e('OU.corners', 'over', 8.5), 'won');
  assert.equal(e('OU.cards', 'over', 4.5), 'won');
  assert.equal(e('FIRST', 'away'), 'won');
  assert.equal(e('LAST', 'home'), 'won', 'el autogol del visitante cuenta para el local');
  // Flashscore aporta las tarjetas del 1.er tiempo que Sofascore no trae.
  const fs1 = { sport: 'football', state: 'finalizado', stats: { cards: { h1: [1, 0] }, offsides: { ft: [3, 1] } } };
  const both = mergeRecords(rec, fs1);
  assert.equal(evaluate('OU.offsides', 'over', 3.5, both), 'won');
  assert.equal(evaluate('OU.cards@h1', 'under', 1.5, both), 'won');
  assert.equal(evaluate('OU.cards', 'over', 4.5, both), 'won', 'vale la de Sofascore');
});
