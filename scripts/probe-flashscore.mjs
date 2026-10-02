// Temporal: explora los feeds de Flashscore (deportes, H2H con últimos partidos, resultados).
const FEED = 'https://global.flashscore.ninja/203/x/feed';
const H = { 'x-fsign': 'SW9D1eZo', 'User-Agent': 'Mozilla/5.0' };
const get = async (name) => {
  const r = await fetch(`${FEED}/${name}`, { headers: H });
  return { status: r.status, text: await r.text() };
};
const parse = (t) => t.split('~').filter(Boolean).map((rec) => Object.fromEntries(rec.split('¬').filter((p) => p.includes('÷')).map((p) => [p.slice(0, p.indexOf('÷')), p.slice(p.indexOf('÷') + 1)])));

console.log('== Deportes (día 0)');
for (let s = 1; s <= 42; s++) {
  const { status, text } = await get(`f_${s}_0_-5_es-pe_1`);
  const recs = parse(text);
  const n = recs.filter((r) => r.AA).length;
  if (n) console.log(`sport ${s}: ${n} partidos · ${recs.find((r) => r.ZA)?.ZA} · ejemplo ${recs.find((r) => r.AA)?.AE} vs ${recs.find((r) => r.AA)?.AF}`);
  else if (status !== 200) console.log(`sport ${s}: HTTP ${status}`);
}
const { text } = await get('f_1_0_-5_es-pe_1');
const recs = parse(text);
const m = recs.find((r) => r.AA && r.AB === '1') || recs.find((r) => r.AA);
console.log('\n== Partido ejemplo (claves):', JSON.stringify(m));
for (const feed of [`df_hh_1_${m.AA}`, `df_sui_1_${m.AA}`, `dc_1_${m.AA}`, `df_st_1_${m.AA}`, `df_od_1_${m.AA}`]) {
  const r = await get(feed);
  console.log(`\n== ${feed}: HTTP ${r.status} · ${r.text.length} car.`);
  console.log(r.text.slice(0, 2500));
}
const prev = parse((await get('f_1_-1_-5_es-pe_1')).text).filter((r) => r.AA);
console.log('\n== Ayer: partidos', prev.length, 'ejemplo', JSON.stringify(prev.find((r) => r.AB === '3')));
