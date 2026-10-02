// Temporal: ¿qué fuentes permiten que una página web (otro dominio) les pida
// datos directamente desde el navegador? Se mira la cabecera CORS.
const ORIGIN = 'https://luisp11127.github.io';
const day = new Date().toISOString().slice(0, 10);
const checks = [
  ['Sofascore web API', `https://www.sofascore.com/api/v1/sport/football/events/live`, {}],
  ['Sofascore api host', `https://api.sofascore.com/api/v1/sport/football/events/live`, {}],
  ['Apuesta Total snapshot', 'https://prod20392.kmianko.com/api/pulse/snapshot/events?lang=ES-PE&t=hPNl', {}],
  ['Apuesta Total mercados', 'https://prod20392.kmianko.com/api/eventlist/eu/markets/all?markets=1%3AML0', { authorization: 'x', session: 'x', 'time-area': '01' }],
  ['Flashscore feed', 'https://global.flashscore.ninja/203/x/feed/f_1_0_-5_es-pe_1', { 'x-fsign': 'SW9D1eZo' }],
  ['FotMob', `https://www.fotmob.com/api/data/matches?date=${day.replace(/-/g, '')}`, {}],
  ['ESPN', 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/news?lang=es', {}],
  ['Understat', 'https://understat.com/getLeagueData/EPL/2026', { 'X-Requested-With': 'XMLHttpRequest' }],
];
for (const [name, url, headers] of checks) {
  const custom = Object.keys(headers);
  let pre = '';
  if (custom.length) {
    const r = await fetch(url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': custom.join(',') } }).catch((e) => ({ status: e.message, headers: new Headers() }));
    pre = ` | preflight ${r.status} allow-origin=${r.headers.get('access-control-allow-origin')} allow-headers=${r.headers.get('access-control-allow-headers')} allow-credentials=${r.headers.get('access-control-allow-credentials')}`;
  }
  const r = await fetch(url, { headers: { Origin: ORIGIN, ...headers } }).catch((e) => ({ status: e.message, headers: new Headers() }));
  console.log(`${name}: GET ${r.status} allow-origin=${r.headers.get('access-control-allow-origin')} allow-credentials=${r.headers.get('access-control-allow-credentials')}${pre}`);
}
