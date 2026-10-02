import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFeatures, FEATURES, upgradeFeatures } from '../docs/js/analysis/features.js';
import { compactNews, expandNews, newsFeatures, sentiment, teamKeys } from '../docs/js/analysis/news.js';
import { sportOf } from '../docs/js/sports.js';

const start = Date.parse('2026-10-03T20:00:00Z');
const at = (h) => new Date(start - h * 3600000).toISOString();
const ARTICLES = [
  { source: 'flashscore', title: 'Universitario recupera a su goleador para el clásico', summary: '', published: at(20) },
  { source: 'espn', title: 'Alianza Lima: dos bajas por lesión ante Universitario', summary: 'El delantero sufre una rotura y el lateral está sancionado', published: at(10) },
  { source: 'fotmob', title: 'Crisis en Alianza Lima tras la derrota', summary: '', published: at(30) },
  { source: 'espn', title: 'Noticia vieja de Alianza Lima', summary: 'lesión', published: at(24 * 6) },
  { source: 'espn', title: 'Sporting Cristal gana y es líder', summary: '', published: at(5) },
];
const ev = { id: 1, sport: 'football', start, home: { name: 'Universitario' }, away: { name: 'Alianza Lima' } };

test('reconoce a cada equipo en las noticias', () => {
  assert.deepEqual(teamKeys('Alianza Lima'), ['alianza lima', 'alianza']);
  assert.deepEqual(teamKeys('Sinner J.'), ['sinner j', 'sinner']);
  assert.ok(!teamKeys('Real Madrid').includes('real'));
  const n = newsFeatures(ev, ARTICLES);
  assert.equal(n.home.n, 2, 'el clásico menciona a ambos');
  assert.equal(n.away.n, 2, 'la noticia de hace 6 días no cuenta');
  assert.equal(n.away.injuries, 1);
  assert.ok(sentiment(n.home) > 0 && sentiment(n.away) < 0);
  assert.equal(newsFeatures(ev, []), null);
  const back = expandNews(JSON.parse(JSON.stringify(compactNews(ARTICLES[1]))));
  assert.equal(back.title, ARTICLES[1].title);
  assert.equal(back.published, Date.parse(ARTICLES[1].published));
});

test('variables de la red: noticias, tipo de mercado y filas antiguas', () => {
  const news = newsFeatures(ev, ARTICLES);
  const cfg = sportOf('football');
  const f = (c, details) => Object.fromEntries(FEATURES.map((k, i) => [k, buildFeatures({ pModel: 0.6, pMarket: 0.55, pBase: 0.57, price: 1.8, line: null, ...c }, { sport: 'football', cfg, model: null, details, quality: 0.4 })[i]]));
  const home = f({ market: '1X2', sel: 'home', family: 'resultado' }, { news });
  const away = f({ market: '1X2', sel: 'away', family: 'resultado' }, { news });
  assert.equal(home.newsAvail, 1);
  assert.ok(home.sideNewsInjuries > 0 && away.sideNewsInjuries < 0, 'las bajas del rival favorecen');
  assert.ok(home.sideNewsSentiment > 0);
  const corners = f({ market: 'OU.corners@h1', sel: 'over', line: 4.5, family: 'periodo', via: 'simulación' }, {});
  assert.equal(corners.newsAvail, 0);
  assert.equal(corners.fPeriod, 1);
  assert.equal(corners.viaSim, 1);
  assert.equal(corners.qualityMarket, 0.4);
  // Filas de la versión 1 (27 variables): se completan con ceros.
  const v1 = Array.from({ length: 27 }, (_, i) => i / 100);
  const up = upgradeFeatures(v1, 1);
  assert.equal(up.length, FEATURES.length);
  assert.equal(up.at(-1), v1[6]);
  assert.equal(upgradeFeatures([1, 2], 1), null);
});
