import assert from 'node:assert/strict';
import test from 'node:test';
import { labelOf, marketId, parseMarket, parseMarketId, swapSelection } from '../docs/js/analysis/catalog.js';
import { evaluate } from '../docs/js/analysis/outcomes.js';
import { AWAY, fixtureMarkets, HOME } from './catalog-fixture.mjs';

const keysOf = (r) => (r?.outcomes || []).map((o) => `${o.market}|${o.sel}|${o.line ?? ''}`);
const parse = (name, sels, sport = 'football', home = HOME, away = AWAY) =>
  parseMarket(
    name,
    sels.map((s, i) => (typeof s === 'string' ? { name: s, price: 1.5 + i / 10 } : s)),
    { sport, home, away },
  );

test('reconoce los mercados de Betano de todos los deportes (lista del Excel)', () => {
  const markets = fixtureMarkets();
  assert.equal(markets.length, 865);
  const counts = {};
  const unknown = [];
  for (const m of markets) {
    const r = parseMarket(m.name, m.selections, { sport: m.sport, home: HOME, away: AWAY });
    const kind = !r ? 'ignorado' : r.unsupported || 'ok';
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'unknown') unknown.push(m.rawName);
  }
  assert.ok(counts.ok >= 620, JSON.stringify(counts));
  // Sin reconocer solo queda uno cuyas selecciones no aparecen en el Excel.
  assert.deepEqual(unknown, ['Córners del Primer Tiempo - Triples']);
  // Los que no se modelan son mercados de jugador, de torneo o sucesos sin datos.
  assert.ok(counts.player >= 140 && counts.outright >= 25 && counts.special <= 70, JSON.stringify(counts));
});

test('mercados principales con las claves de siempre', () => {
  assert.deepEqual(keysOf(parse('Resultado del partido', ['1', 'X', '2'])), ['1X2|home|', '1X2|draw|', '1X2|away|']);
  assert.deepEqual(keysOf(parse('Goles totales Más/Menos', ['Más de 2.5', 'Menos 2.5'])), ['OU|over|2.5', 'OU|under|2.5']);
  assert.deepEqual(keysOf(parse('Doble oportunidad', ['1X', '12', '2X'])), ['DC|1X|', 'DC|12|', 'DC|X2|']);
  assert.deepEqual(keysOf(parse('Ambos equipos anotan', ['Sí', 'No'])), ['BTTS|yes|', 'BTTS|no|']);
  assert.equal(parse('Resultado del partido SuperCuotas', ['1']), null);
});

test('estadísticas, periodos y equipos', () => {
  assert.deepEqual(keysOf(parse('Más/Menos Córners', ['Más de 8.5', 'Menos 8.5'])), ['OU.corners|over|8.5', 'OU.corners|under|8.5']);
  assert.deepEqual(keysOf(parse(`${HOME} - Goles totales Más/Menos`, ['Más de 1.5', 'Menos 1.5'])), ['OU:home|over|1.5', 'OU:home|under|1.5']);
  assert.deepEqual(keysOf(parse(`Primer Tiempo ${AWAY} Más/Menos Córners`, ['Más de 2.5', 'Menos 2.5'])), ['OU.corners@h1:away|over|2.5', 'OU.corners@h1:away|under|2.5']);
  // Los totales de otras estadísticas ya no se confunden con goles.
  assert.deepEqual(keysOf(parse('Total de Faltas Cometidas', ['Más de 22.5', 'Menos 22.5'])), ['OU.fouls|over|22.5', 'OU.fouls|under|22.5']);
  assert.deepEqual(keysOf(parse('Total de rebotes en el partido', ['Más de 88.5', 'Menos 88.5'], 'basketball')), ['OU.reb|over|88.5', 'OU.reb|under|88.5']);
  assert.deepEqual(keysOf(parse('Total de Minutos de penalización', ['Más de 16.5', 'Menos 16.5'], 'ice-hockey')), ['OU.pim|over|16.5', 'OU.pim|under|16.5']);
  // Hockey: el resultado con empate es el del tiempo reglamentario.
  assert.deepEqual(keysOf(parse('Ganador', [HOME, 'Empate', AWAY], 'ice-hockey')), ['1X2@reg|home|', '1X2@reg|draw|', '1X2@reg|away|']);
  assert.deepEqual(keysOf(parse('5 entradas completas - Total de Runs', ['Más de 4.5', 'Menos 4.5'], 'baseball')), ['OU@i1-5|over|4.5', 'OU@i1-5|under|4.5']);
});

test('nombres de Apuesta Total', () => {
  assert.deepEqual(keysOf(parse('1ra mitad: 1x2', [HOME, 'Empate', AWAY])), ['1X2@h1|home|', '1X2@h1|draw|', '1X2@h1|away|']);
  assert.deepEqual(keysOf(parse(`${AWAY}: Total de goles`, ['Más de 1.5', 'Menos de 1.5'])), ['OU:away|over|1.5', 'OU:away|under|1.5']);
  assert.deepEqual(keysOf(parse(`${HOME}: Mantendrá portería a cero`, ['Sí', 'No'])), ['OU:away|under|0.5', 'OU:away|over|0.5']);
  assert.deepEqual(keysOf(parse('Goles exactos', ['No hay goles', '1 Gol', '2 Goles'])), ['CNT|0|', 'CNT|1|', 'CNT|2|']);
  assert.deepEqual(keysOf(parse('Total tiros de esquina (asiático)', ['Más de 9.25', 'Menos de 9.25'])), ['OU.corners|over|9.25', 'OU.corners|under|9.25']);
  assert.deepEqual(keysOf(parse('Mitad/Final', [`${HOME}/${HOME}`, `${HOME}/${AWAY}`])), ['AND|1X2@h1~home~+1X2~home~|', 'AND|1X2@h1~home~+1X2~away~|']);
  assert.deepEqual(keysOf(parse('1er set: Marcador exacto', [`${HOME} 6:1`, `${AWAY} 6:1`], 'tennis')), ['CS@s1|6-1|', 'CS@s1|1-6|']);
  assert.deepEqual(keysOf(parse('Ganador 1er Inning', [HOME, 'Empate', AWAY], 'baseball')), ['1X2@i1|home|', '1X2@i1|draw|', '1X2@i1|away|']);
  assert.deepEqual(keysOf(parse('Margen de victoria (incl. prórroga)', [`${HOME} gana por 1 a 2`, `${AWAY} gana por 3 a 6`], 'basketball')), ['MRG|home:1-2|', 'MRG|away:3-6|']);
});

test('equipos al revés: se da vuelta cada selección', () => {
  const sw = (m, s, l) => {
    const x = swapSelection(parseMarketId(m), s, l);
    return `${marketId(x.spec)}|${x.sel}|${x.line ?? ''}`;
  };
  assert.equal(sw('HCP', 'home', -1.5), 'HCP|away|1.5');
  assert.equal(sw('OU.corners:home', 'over', 4.5), 'OU.corners:away|over|4.5');
  assert.equal(sw('CS', 'home!1-0,2-1', null), 'CS|away!0-1,1-2|');
  assert.equal(sw('AND', '1X2@h1~home~+DC~1X~', null), 'AND|1X2@h1~away~+DC~X2~|');
  assert.equal(sw('MRG', 'home:3+', null), 'MRG|away:3+|');
});

// Partido de prueba: 2-1 (1-0 al descanso), córners 6-3, goles a los 20', 55' y 80'.
const REC = {
  sport: 'football',
  state: 'finalizado',
  per: [
    [1, 0],
    [1, 1],
  ],
  nReg: 2,
  final: [2, 1],
  events: [
    { k: 'goal', team: 'home', min: 20 },
    { k: 'card', team: 'away', min: 30 },
    { k: 'goal', team: 'away', min: 55 },
    { k: 'goal', team: 'home', min: 80 },
  ],
  stats: { corners: { ft: [6, 3], h1: [4, 1], h2: [2, 2] }, cards: { ft: [0, 1] } },
};

test('liquida con el registro del partido', () => {
  const ev = (m, s, l = null) => evaluate(m, s, l, REC);
  assert.equal(ev('1X2', 'home'), 'won');
  assert.equal(ev('OU', 'over', 2.5), 'won');
  assert.equal(ev('OU', 'under', 3.5), 'won');
  assert.equal(ev('OU', 'over', 3), 'void');
  assert.equal(ev('OU', 'over', 2.75), 'half_won');
  assert.equal(ev('HCP', 'home', -1), 'void');
  assert.equal(ev('HCP', 'home', -1.25), 'half_lost');
  assert.equal(ev('OU.corners', 'over', 8.5), 'won');
  assert.equal(ev('OU.corners@h1:home', 'over', 3.5), 'won');
  assert.equal(ev('1X2.corners', 'home'), 'won');
  assert.equal(ev('PMAX@halves', 'h2'), 'won');
  assert.equal(ev('AND', '1X2@h1~home~+1X2~home~'), 'won');
  assert.equal(ev('AND', '1X2@h1~home~+1X2~home~+OU~under~1.5'), 'lost');
  assert.equal(ev('OR', '!BTTS~yes~+OU~over~2.5'), 'lost');
  assert.equal(ev('CS', '2-1'), 'won');
  assert.equal(ev('CS', 'home!1-0,2-0'), 'won');
  assert.equal(ev('MRG', 'home:1'), 'won');
  assert.equal(ev('FIRST', 'home'), 'won');
  assert.equal(ev('LAST', 'home'), 'won');
  assert.equal(ev('FGT', '20-30'), 'won');
  assert.equal(ev('OU@m0-32', 'over', 0.5), 'won');
  assert.equal(ev('COMEBACK:away', 'yes'), 'lost');
  assert.equal(ev('SCOREALL@halves:home', 'yes'), 'won');
  assert.equal(ev('WINALL@halves:home', 'yes'), 'lost');
  assert.equal(ev('OU.shots', 'over', 10.5), null, 'sin datos de tiros no se liquida');
  assert.equal(evaluate('1X2', 'home', null, { ...REC, state: 'cancelado', voidable: true }), 'void');
});

test('etiquetas en español para cualquier mercado', () => {
  const names = { home: 'Universitario', away: 'Alianza' };
  assert.equal(labelOf('OU.corners@h1:home', 'over', 4.5, 'football', names), 'Más de 4.5 córners de Universitario (1.er tiempo)');
  assert.equal(labelOf('HCP', 'away', 1.5, 'football', names), 'Alianza -1.5 (hándicap)');
  assert.equal(labelOf('OU@i1-5', 'under', 4.5, 'baseball', names), 'Menos de 4.5 carreras (primeras 5 entradas)');
});
