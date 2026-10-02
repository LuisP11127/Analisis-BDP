// Descarga muestras de endpoints candidatos y muestra su estructura
// (claves, tipos, primer elemento de cada lista) para diseñar los parsers.
// Uso: node scripts/sample-endpoints.js
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const today = new Date();
const ymd = today.toISOString().slice(0, 10);
const ymdCompact = ymd.replace(/-/g, '');
const season = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;

const KM = 'https://prod20392.kmianko.com';
const endpoints = [
  // Apuesta Total (proveedor de cuotas)
  [`${KM}/api/sportscenter/carousels/featured-matches/events?language=ES-PE&customerLevel=0&draft=false&epoEnabled=true`],
  // Flashscore (feed propio; requiere cabecera x-fsign)
  ['https://local-global.flashscore.ninja/2/x/feed/f_1_0_-5_es_1', { 'x-fsign': 'SW9D1eZo', Referer: 'https://www.flashscore.com/' }],
  ['https://d.flashscore.com/x/feed/f_1_0_-5_es_1', { 'x-fsign': 'SW9D1eZo', Referer: 'https://www.flashscore.com/' }],
  // ESPN (API pública: noticias y resultados)
  ['https://site.api.espn.com/apis/site/v2/sports/soccer/all/news?lang=es&region=pe'],
  ['https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/news?lang=es'],
  ['https://site.api.espn.com/apis/site/v2/sports/soccer/per.1/scoreboard'],
  [`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${ymdCompact}`],
  // ClubElo (ranking Elo de clubes europeos, CSV)
  [`http://api.clubelo.com/${ymd}`],
  // Understat (xG de las 5 grandes ligas)
  [`https://understat.com/getLeagueData/EPL/${season}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://understat.com/league/EPL' }],
  ['https://understat.com/league/EPL'],
  // FotMob
  [`https://www.fotmob.com/api/data/matches?date=${ymdCompact}`],
  [`https://www.fotmob.com/api/matches?date=${ymdCompact}`],
  // Otros (solo estado)
  ['https://fbref.com/es/'],
  ['https://www.transfermarkt.com/'],
];

function shape(v, depth = 0, max = 4) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return depth >= max ? `[…×${v.length}]` : `[${shape(v[0], depth + 1, max)}]×${v.length}`;
  }
  if (typeof v === 'object') {
    if (depth >= max) return '{…}';
    const keys = Object.keys(v);
    const parts = keys.slice(0, 25).map((k) => `${k}:${shape(v[k], depth + 1, max)}`);
    if (keys.length > 25) parts.push(`…+${keys.length - 25}`);
    return `{${parts.join(', ')}}`;
  }
  if (typeof v === 'string') return `"${v.slice(0, 40)}"`;
  return String(v);
}

(async () => {
  for (const [url, headers = {}] of endpoints) {
    console.log(`\n===== ${url}`);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-PE,es;q=0.9', Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      const ctype = r.headers.get('content-type') || '';
      console.log(`estado=${r.status} tipo=${ctype} tamaño=${text.length}`);
      let json;
      try {
        json = JSON.parse(text);
      } catch {}
      if (json !== undefined) console.log('estructura: ' + shape(json).slice(0, 3000));
      else console.log('inicio: ' + text.slice(0, 1200).replace(/\s+/g, ' '));
    } catch (e) {
      console.log('ERROR ' + e.message);
    }
  }
})();
