// Exploración temporal: formatos de los feeds de detalle de Flashscore
// (estadísticas, incidencias, marcadores por periodo) y de los mercados
// completos de Apuesta Total. Solo imprime muestras.
const FEED = 'https://global.flashscore.ninja/203/x/feed';
const H = { 'x-fsign': 'SW9D1eZo' };
const get = async (name) => {
  try {
    const r = await fetch(`${FEED}/${name}`, { headers: H, signal: AbortSignal.timeout(20000) });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: e.message };
  }
};
const records = (t) => t.split('~').filter(Boolean).map((r) => Object.fromEntries(r.split('¬').filter((p) => p.includes('÷')).map((p) => [p.slice(0, p.indexOf('÷')), p.slice(p.indexOf('÷') + 1)])));
const show = (label, t, n = 1800) => console.log(`\n--- ${label}\n${String(t).slice(0, n)}`);

for (const [sport, id] of [['football', 1], ['basketball', 3], ['tennis', 2], ['ice-hockey', 4], ['baseball', 6]]) {
  console.log(`\n================ ${sport}`);
  const day = await get(`f_${id}_-1_-5_es-pe_1`);
  const recs = records(day.text);
  const done = recs.filter((r) => r.AA && r.AB === '3');
  console.log(`ayer: ${recs.filter((r) => r.AA).length} partidos, ${done.length} terminados`);
  const m = done[Math.min(3, done.length - 1)];
  if (!m) continue;
  show(`registro del día (${m.AE} vs ${m.AF})`, JSON.stringify(m), 1500);
  for (const f of ['df_st_1_', 'df_sui_1_', 'dc_1_', 'df_mh_1_', 'df_li_1_']) {
    const r = await get(`${f}${m.AA}`);
    show(`${f}${m.AA} HTTP ${r.status} (${r.text.length} chars)`, r.text, sport === 'football' ? 3000 : 1500);
  }
  if (sport === 'football') {
    const hh = await get(`df_hh_1_${m.AA}`);
    const rows = records(hh.text).filter((r) => r.KC).slice(0, 2);
    show('filas H2H (todos los campos)', JSON.stringify(rows), 1500);
  }
}

// Apuesta Total: mercados completos de un evento.
const AT = 'https://prod20392.kmianko.com';
const page = await fetch(`${AT}/es-pe/spbkv3?operatorToken=logout`, { signal: AbortSignal.timeout(25000) });
const jar = {};
for (const c of page.headers.getSetCookie?.() || []) {
  const p = c.split(';')[0];
  jar[p.slice(0, p.indexOf('='))] = p.slice(p.indexOf('=') + 1);
}
const ath = { 'time-area': '01', ...(jar.authorization ? { authorization: jar.authorization, session: jar.session } : {}) };
const snap = await (await fetch(`${AT}/api/pulse/snapshot/events?lang=ES-PE&t=hPNl`, { headers: ath })).json().catch(() => null);
const evs = Array.isArray(snap) ? snap : snap?.events || snap?.Events || Object.values(snap || {}).find(Array.isArray) || [];
console.log('\n================ Apuesta Total', Array.isArray(evs) ? evs.length : typeof evs);
const ev = (Array.isArray(evs) ? evs : []).find((e) => /futbol|fútbol|soccer/i.test(JSON.stringify(e).slice(0, 400)) && !e.IsLive) || evs[0];
show('evento', JSON.stringify(ev), 800);
const eid = ev?.Id ?? ev?.id ?? ev?.EventId;
for (const p of [
  `/api/eventlist/eu/markets/all?markets=${encodeURIComponent(eid)}`,
  `/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${eid}:`)}`,
  `/api/eventpage/eu/events/${eid}?lang=ES-PE`,
  `/api/eventlist/eu/events/${eid}/markets`,
  `/api/eu/event/${eid}`,
  `/api/sportsbook/event/${eid}`,
]) {
  try {
    const r = await fetch(`${AT}${p}`, { headers: ath, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    show(`${p} HTTP ${r.status} (${t.length} chars)`, t, 1200);
  } catch (e) {
    console.log(p, e.message);
  }
}
