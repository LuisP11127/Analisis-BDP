// Prueba temporal: resumen de lo que publicó scripts/collect-data.mjs en
// <salida>/data/fuente (resultados con periodos, registros completos y
// estadísticas de equipo). Uso: node scripts/probe-detalle.mjs <salida>
import fs from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'site', 'data/fuente');
const resDir = path.join(dir, 'resultados');
let withPer = 0;
let withRecord = 0;
let numeric = 0;
const samples = [];
for (const f of (await fs.readdir(resDir)).sort()) {
  const data = JSON.parse(await fs.readFile(path.join(resDir, f), 'utf8'));
  for (const [id, r] of Object.entries(data)) {
    if (r[3]) withPer++;
    if (r[4]) {
      withRecord++;
      if (!id.startsWith('fs:')) numeric++;
      if (samples.length < 6) samples.push([f, id, JSON.stringify(r).slice(0, 700)]);
    }
  }
}
console.log(`Resultados con periodos: ${withPer} · con registro completo: ${withRecord} (de Sofascore cruzados por nombre: ${numeric})`);
for (const s of samples) console.log(' ', ...s);

const index = JSON.parse(await fs.readFile(path.join(dir, 'indice.json'), 'utf8'));
for (const [date, bySport] of Object.entries(index.days)) {
  for (const sport of Object.keys(bySport)) {
    const day = JSON.parse(await fs.readFile(path.join(dir, date, `${sport}.json`), 'utf8'));
    const details = Object.entries(day.details || {});
    const ts = details.filter(([, d]) => d.ts);
    const groups = Object.values(day.offers || {}).reduce((n, o) => n + (o.g?.length || 0), 0);
    const markets = new Set(Object.values(day.offers || {}).flatMap((o) => (o.o || []).map((x) => x[0])));
    console.log(`${date} ${sport}: ${details.length} con H2H, ${ts.length} con estadísticas de equipo, ${groups} grupos de cuotas, ${markets.size} mercados distintos`);
    if (ts.length && date === index.today) console.log('   ejemplo', ts[0][0], JSON.stringify(ts[0][1].ts).slice(0, 600));
    if (date === index.today && markets.size) console.log('   mercados', [...markets].slice(0, 40).join(' '));
  }
}

// Motor con datos reales: candidatos y picks por tipo de mercado.
const { expandDay } = await import('../docs/js/data-format.js');
const { analyzeEvent } = await import('../docs/js/analysis/engine.js');
const { selectPicks } = await import('../docs/js/analysis/picks.js');
const { xgFromTeamStats } = await import('../docs/js/analysis/teamstats.js');
const families = {};
const picks = [];
let bad = 0;
let n = 0;
const t0 = Date.now();
for (const sport of ['football', 'basketball', 'tennis', 'ice-hockey', 'baseball', 'volleyball']) {
  let day;
  try {
    day = expandDay(JSON.parse(await fs.readFile(path.join(dir, index.today, `${sport}.json`), 'utf8')));
  } catch {
    continue;
  }
  const evs = day.events.filter((e) => day.offers.get(e.id)?.length && e.state === 'pendiente').slice(0, sport === 'football' ? 25 : 8);
  for (const ev of evs) {
    const d = day.details.get(ev.id) || {};
    const { candidates } = analyzeEvent(ev, d, day.offers.get(ev.id), { xg: day.xg.get(ev.id) || xgFromTeamStats(d.teamStats) || undefined });
    n++;
    for (const c of candidates) {
      families[`${sport}:${c.family}:${c.via}`] = (families[`${sport}:${c.family}:${c.via}`] || 0) + 1;
      if (!(c.p > 0 && c.p < 1) || !c.x.every(Number.isFinite)) bad++;
    }
    for (const p of selectPicks(candidates)) picks.push(`${sport} ${ev.home.name} vs ${ev.away.name}: ${p.label} @${p.best.price} p=${p.p.toFixed(2)} (${p.via} ${p.pModel?.toFixed(2)}, mercado ${p.pMarket?.toFixed(2) ?? '-'})`);
  }
}
console.log(`\nMotor: ${n} partidos en ${((Date.now() - t0) / 1000).toFixed(1)} s, ${bad} candidatos inválidos`);
for (const [k, v] of Object.entries(families).sort()) console.log(`  ${k}: ${v}`);
console.log('Picks:');
for (const p of picks.slice(0, 60)) console.log('  ' + p);

const newsFile = JSON.parse(await fs.readFile(path.join(dir, 'noticias.json'), 'utf8'));
const bySource = {};
for (const it of newsFile.items) bySource[it[0]] = (bySource[it[0]] || 0) + 1;
console.log(`\nNoticias: ${newsFile.items.length}`, JSON.stringify(bySource), newsFile.items.slice(0, 5).map((x) => x[1]).join(' | '));
