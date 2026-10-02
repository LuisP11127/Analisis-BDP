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
