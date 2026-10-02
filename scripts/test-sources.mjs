// Ejecuta el diagnóstico de los conectores de la extensión fuera del navegador
// (Node 22). Solo sirve para las fuentes que responden desde servidores;
// Sofascore y Betano necesitan el navegador con conexión desde Perú.
// Uso: node scripts/test-sources.mjs [fuente ...]
const SERVER_SOURCES = ['flashscore', 'fotmob', 'espn', 'understat', 'apuestatotal'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : SERVER_SOURCES;

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : '');

function describe(item) {
  if (item.markets) {
    const markets = item.markets.map((m) => `${m.name}: ${m.selections.map((s) => `${s.name} ${s.price}`).join(' · ')}`);
    return `${fmt(item.start)} · ${item.league} · ${item.home} vs ${item.away}\n      ${markets.join('\n      ')}`;
  }
  if (item.home !== undefined) return `${fmt(item.start)} · ${item.league} (${item.country}) · ${item.home} vs ${item.away} ${item.score ? `${item.score.home}-${item.score.away}` : ''} [${item.status}]`;
  if (item.team) return `${item.team}: xG ${item.xgFor} / xGA ${item.xgAgainst} · ${item.points} pts`;
  if (item.title) return `${item.title} (${fmt(item.published)}) ${item.url || ''}`;
  return JSON.stringify(item).slice(0, 300);
}

let failed = 0;
for (const id of ids) {
  const { default: source } = await import(new URL(`../extension/sources/${id}.js`, import.meta.url));
  const started = Date.now();
  console.log(`\n===== ${source.name}`);
  try {
    const r = await source.diagnose();
    const ok = r.count > 0;
    if (!ok) failed++;
    console.log(`${ok ? 'OK' : 'SIN DATOS'} · ${r.count} resultados · ${((Date.now() - started) / 1000).toFixed(1)} s · modo ${r.mode}`);
    for (const item of r.sample || []) console.log('  - ' + describe(item));
    if (r.details) console.log('  detalles: ' + JSON.stringify(r.details).slice(0, 2500));
  } catch (e) {
    failed++;
    console.log(`ERROR · ${e.message}${e.status ? ` (HTTP ${e.status})` : ''}`);
    if (e.snippet) console.log('  respuesta: ' + e.snippet);
  }
}
process.exitCode = failed ? 1 : 0;
