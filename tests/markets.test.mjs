import assert from 'node:assert/strict';
import test from 'node:test';
import {
  marketProbabilities,
  offersFromApuestaTotal,
  offersFromSofascore,
  selectionLabel,
  settle,
} from '../docs/js/analysis/markets.js';

const finished = (home, away, extra = {}) => ({ state: 'finalizado', score: { home, away, ...extra } });

test('liquida 1X2, doble oportunidad, más/menos, ambos marcan y hándicap', () => {
  const r = finished(2, 1);
  assert.equal(settle({ market: '1X2', sel: 'home' }, r, 'football'), 'won');
  assert.equal(settle({ market: '1X2', sel: 'draw' }, r, 'football'), 'lost');
  assert.equal(settle({ market: 'DC', sel: '1X' }, r, 'football'), 'won');
  assert.equal(settle({ market: 'DC', sel: 'X2' }, r, 'football'), 'lost');
  assert.equal(settle({ market: 'DC', sel: '12' }, r, 'football'), 'won');
  assert.equal(settle({ market: 'OU', sel: 'over', line: 2.5 }, r, 'football'), 'won');
  assert.equal(settle({ market: 'OU', sel: 'under', line: 2.5 }, r, 'football'), 'lost');
  assert.equal(settle({ market: 'OU', sel: 'over', line: 3 }, r, 'football'), 'void');
  assert.equal(settle({ market: 'BTTS', sel: 'yes' }, r, 'football'), 'won');
  assert.equal(settle({ market: 'HCP', sel: 'home', line: -1.5 }, r, 'basketball'), 'lost');
  assert.equal(settle({ market: 'HCP', sel: 'away', line: -1.5 }, r, 'basketball'), 'won');
  assert.equal(settle({ market: 'HCP', sel: 'home', line: -1 }, r, 'basketball'), 'void');
});

test('en fútbol cuenta el marcador de los 90 minutos', () => {
  const r = finished(3, 2, { homeNT: 2, awayNT: 2 }); // ganó en la prórroga
  assert.equal(settle({ market: '1X2', sel: 'draw' }, r, 'football'), 'won');
  assert.equal(settle({ market: 'OU', sel: 'over', line: 4.5 }, r, 'football'), 'lost');
  // El ganador "incluye prórroga" usa el marcador final.
  assert.equal(settle({ market: 'ML', sel: 'home' }, finished(4, 3), 'ice-hockey'), 'won');
});

test('partido sin terminar queda pendiente; cancelado se anula tras el plazo', () => {
  assert.equal(settle({ market: '1X2', sel: 'home' }, { state: 'en_vivo', score: { home: 1, away: 0 } }, 'football'), null);
  assert.equal(settle({ market: '1X2', sel: 'home' }, { state: 'cancelado', score: null }, 'football'), null);
  assert.equal(settle({ market: '1X2', sel: 'home' }, { state: 'cancelado', score: null, final: true }, 'football'), 'void');
});

// Estructura real de Apuesta Total (Bélgica vs Turquía, 2 oct 2026).
const AT_EVENT = { eventId: '892643206372798464', start: Date.parse('2026-10-02T18:45:00Z'), home: 'Bélgica', away: 'Turquía' };
const AT_MARKETS = [
  {
    name: 'Resultado del partido (1X2)',
    type: 'ML0',
    selections: [
      { name: 'Empate', outcome: 'Empate', price: 4.55 },
      { name: 'Bélgica', outcome: 'Local', price: 1.52 },
      { name: 'Turquía', outcome: 'Visitante', price: 5.3 },
    ],
  },
  {
    name: 'Total de goles',
    type: 'OU200',
    selections: [
      { name: 'Más de 2.5', price: 1.43 },
      { name: 'Menos de 2.5', price: 2.79 },
      { name: 'Más de 3.5', price: 2.07 },
      { name: 'Menos de 3.5', price: 1.75 },
    ],
  },
  { name: 'Ambos equipos anotan', type: 'QA158', selections: [{ name: 'Sí', price: 1.56 }, { name: 'No', price: 2.37 }] },
  {
    name: 'Doble Oportunidad',
    type: 'QA61',
    selections: [
      { name: 'Bélgica o Empate', price: 1.17 },
      { name: 'Empate o Turquía', price: 2.47 },
      { name: 'Bélgica o Turquía', price: 1.21 },
    ],
  },
  { name: 'Total de goles 1ra mitad', type: 'OU249', selections: [{ name: 'Más de 0.5', price: 1.3 }] },
];
const SOFA_EVENT = { id: 1, sport: 'football', start: AT_EVENT.start, home: { name: 'Belgium', short: 'Belgium' }, away: { name: 'Türkiye', short: 'Türkiye' } };

test('traduce las cuotas de Apuesta Total aunque los nombres estén en otro idioma', () => {
  const offers = offersFromApuestaTotal(AT_MARKETS, AT_EVENT, SOFA_EVENT);
  const find = (market, sel, line = null) => offers.find((o) => o.market === market && o.sel === sel && o.line === line)?.price;
  assert.equal(find('1X2', 'home'), 1.52);
  assert.equal(find('1X2', 'draw'), 4.55);
  assert.equal(find('1X2', 'away'), 5.3);
  assert.equal(find('OU', 'over', 2.5), 1.43);
  assert.equal(find('OU', 'under', 3.5), 1.75);
  assert.equal(find('BTTS', 'yes'), 1.56);
  assert.equal(find('DC', '1X'), 1.17);
  assert.equal(find('DC', 'X2'), 2.47);
  assert.equal(find('DC', '12'), 1.21);
  assert.ok(!offers.some((o) => o.line === 0.5), 'no debe incluir el total de la 1.ª mitad');
});

test('si la casa lista los equipos al revés, se corrigen los lados', () => {
  const swapped = { ...AT_EVENT, home: 'Turquía', away: 'Bélgica' };
  const offers = offersFromApuestaTotal(AT_MARKETS, swapped, SOFA_EVENT, true);
  assert.equal(offers.find((o) => o.market === '1X2' && o.sel === 'home').price, 1.52);
  assert.equal(offers.find((o) => o.market === 'DC' && o.sel === '1X').price, 1.17);
});

test('probabilidad implícita sin margen suma 1', () => {
  const p = marketProbabilities(offersFromApuestaTotal(AT_MARKETS, AT_EVENT, SOFA_EVENT));
  const total = p.get('1X2|home|') + p.get('1X2|draw|') + p.get('1X2|away|');
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(p.get('1X2|home|') > 0.6 && p.get('1X2|home|') < 0.66);
  assert.ok(Math.abs(p.get('OU|over|2.5') + p.get('OU|under|2.5') - 1) < 1e-9);
  // Doble oportunidad: cada selección cubre dos resultados, suman 2.
  assert.ok(Math.abs(p.get('DC|1X|') + p.get('DC|X2|') + p.get('DC|12|') - 2) < 1e-9);
});

test('traduce las cuotas de Sofascore e ignora mercados parciales', () => {
  const markets = [
    { name: 'Full time', group: null, choices: [{ name: '1', price: 1.5 }, { name: 'X', price: 4.2 }, { name: '2', price: 6 }] },
    { name: 'Double chance', group: null, choices: [{ name: '1X', price: 1.1 }, { name: 'X2', price: 2.5 }, { name: '12', price: 1.25 }] },
    { name: 'Match goals', group: '2.5', choices: [{ name: 'Over', price: 1.6 }, { name: 'Under', price: 2.3 }] },
    { name: '1st half', group: null, choices: [{ name: '1', price: 2 }, { name: 'X', price: 2.1 }, { name: '2', price: 7 }] },
    { name: 'Draw no bet', group: null, choices: [{ name: '1', price: 1.2 }, { name: '2', price: 4.5 }] },
    { name: 'Both teams to score', group: null, choices: [{ name: 'Yes', price: 1.7 }, { name: 'No', price: 2.05 }] },
  ];
  const offers = offersFromSofascore(markets, SOFA_EVENT);
  assert.equal(offers.filter((o) => o.market === '1X2').length, 3);
  assert.equal(offers.find((o) => o.market === '1X2' && o.sel === 'home').price, 1.5);
  assert.equal(offers.find((o) => o.market === 'OU' && o.sel === 'over').line, 2.5);
  assert.equal(offers.filter((o) => o.market === 'BTTS').length, 2);
  assert.ok(!offers.some((o) => o.market === 'ML'), 'el empate no válido no es ganador del partido');
  assert.equal(offers.length, 10);
});

test('etiquetas en español', () => {
  const ev = { home: { name: 'Bélgica' }, away: { name: 'Turquía' } };
  assert.equal(selectionLabel({ market: 'DC', sel: '1X' }, ev), 'Bélgica o empate');
  assert.equal(selectionLabel({ market: 'OU', sel: 'over', line: 2.5 }, ev), 'Más de 2.5 goles');
  assert.equal(selectionLabel({ market: 'HCP', sel: 'away', line: -4.5 }, ev, 'puntos'), 'Turquía +4.5 (hándicap)');
});
