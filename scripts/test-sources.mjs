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

// H2H de Flashscore (lo usa la recolección de datos de la página): cada equipo
// debe tener sus propios últimos partidos.
if (ids.includes('flashscore')) {
  const fs = await import(new URL('../extension/sources/flashscore.js', import.meta.url));
  console.log('\n===== Flashscore H2H');
  try {
    const { items } = await fs.getSportDay({ sport: 'football', day: 0 });
    const sample = items.filter((e) => e.state === 'pendiente' && e.home.id && e.away.id).slice(0, 6);
    const form = (list) => list.slice(0, 5).map((m) => `${m.gf}-${m.ga}${m.r}`).join(' ');
    let good = 0;
    for (const ev of sample) {
      const d = await fs.getH2H({ fsId: ev.id.slice(3), homeId: ev.home.id, awayId: ev.away.id });
      const same = d.lastHome.length > 0 && d.lastHome.every((m, i) => d.lastAway[i]?.start === m.start);
      if (d.lastHome.length && d.lastAway.length && !same) good++;
      console.log(`  - ${ev.home.name} vs ${ev.away.name}: ${d.lastHome.length}/${d.lastAway.length} partidos · H2H ${JSON.stringify(d.h2h)}\n      ${form(d.lastHome)} | ${form(d.lastAway)}${same ? ' ¡IGUALES!' : ''}`);
    }
    console.log(`${good ? 'OK' : 'SIN DATOS'} · ${good} de ${sample.length} con los últimos partidos de ambos equipos`);
    if (!good) failed++;
  } catch (e) {
    failed++;
    console.log(`ERROR · ${e.message}`);
  }
}

process.exitCode = failed ? 1 : 0;
