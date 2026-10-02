// Exploración temporal (2): estadísticas de ligas principales y de cada
// deporte, desempates de tenis y mercados completos de Apuesta Total.
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

async function finished(sportId, test = () => true, days = [-1, -2, -3]) {
  const out = [];
  for (const d of days) {
    let league = '';
    for (const r of records((await get(`f_${sportId}_${d}_-5_es-pe_1`)).text)) {
      if (r.ZA) league = r.ZA;
      else if (r.AA && r.AB === '3' && test(league, r)) out.push({ ...r, league });
    }
    if (out.length > 5) break;
  }
  return out;
}

// Fútbol de ligas principales: nombres de todas las estadísticas e incidencias.
const top = await finished(1, (l) => /ESPAÑA: LaLiga|INGLATERRA: Premier League|ITALIA: Serie A|ALEMANIA: Bundesliga|FRANCIA: Ligue 1|Champions|Europa League|LIGA 1|BRASIL: Serie A/i.test(l), [-1, -2, -3, -4, -5]);
console.log(`\n================ fútbol principal: ${top.length}`);
for (const m of top.slice(0, 2)) {
  show(`${m.league}: ${m.AE} vs ${m.AF} (${m.AA}) registro`, JSON.stringify(m), 900);
  const st = records((await get(`df_st_1_${m.AA}`)).text);
  console.log('estadísticas:', st.filter((r) => r.SE || r.SG).map((r) => r.SE ? `[${r.SE}]` : `${r.SG}=${r.SH}/${r.SI}`).join(' | '));
  show('incidencias', (await get(`df_sui_1_${m.AA}`)).text, 3500);
}

for (const [name, id] of [['hockey', 4], ['fútbol americano', 5], ['balonmano', 7], ['rugby', 8], ['vóley', 12], ['dardos', 14], ['tenis de mesa', 25], ['mma', 28], ['esports', 36], ['futsal', 11], ['waterpolo', 22], ['bádminton', 21], ['críquet', 13], ['snooker', 15], ['floorball', 9]]) {
  const list = await finished(id);
  console.log(`\n================ ${name} (${id}): ${list.length} terminados`);
  let shown = 0;
  for (const m of list) {
    const st = await get(`df_st_1_${m.AA}`);
    if (!st.text && shown === 0 && m !== list[list.length - 1]) continue;
    show(`${m.league}: ${m.AE} vs ${m.AF} registro`, JSON.stringify(m), 700);
    const recs = records(st.text);
    console.log('estadísticas:', recs.filter((r) => r.SE || r.SG).slice(0, 60).map((r) => r.SE ? `[${r.SE}]` : `${r.SG}=${r.SH}/${r.SI}`).join(' | ').slice(0, 1500));
    show('incidencias', (await get(`df_sui_1_${m.AA}`)).text, 900);
    if (++shown >= 1) break;
  }
}

// Tenis: set con desempate.
const tb = (await finished(2)).find((m) => ['BA', 'BC', 'BE'].some((k, i) => (m[k] === '7' && m[['BB', 'BD', 'BF'][i]] === '6') || (m[k] === '6' && m[['BB', 'BD', 'BF'][i]] === '7')));
if (tb) {
  show('tenis con desempate: registro', JSON.stringify(tb), 1200);
  show('dc_1', (await get(`dc_1_${tb.AA}`)).text, 600);
  show('df_sui', (await get(`df_sui_1_${tb.AA}`)).text, 600);
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
const evs = Array.isArray(snap) ? snap : [];
const ev = evs.filter((e) => e.SportName === 'Fútbol' && !e.IsLive && e.IsTopLeague).sort((a, b) => b.TotalMarketsCount - a.TotalMarketsCount)[0];
console.log('\n================ Apuesta Total', evs.length, ev?._id, ev?.EventName, ev?.TotalMarketsCount);
for (const p of [
  `/api/eventpage/eu/events/${ev._id}?lang=ES-PE`,
  `/api/eu/events/${ev._id}?lang=ES-PE`,
  `/api/eventlist/eu/events/${ev._id}/markets`,
  `/api/eventlist/eu/markets/all?markets=${encodeURIComponent(ev._id)}`,
  `/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${ev._id}:ML0|OU200|QA61|QA158|HC200|OU201|OU202|QA200`)}`,
  `/api/eventpage/eu/events/${ev._id}/markets?lang=ES-PE`,
]) {
  try {
    const r = await fetch(`${AT}${p}`, { headers: ath, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    let summary = '';
    try {
      const j = JSON.parse(t);
      const list = Array.isArray(j) ? j : j.Markets || j.markets || [];
      summary = `\nmercados: ${list.length} · ${list.slice(0, 200).map((m) => `${m.MarketType?._id || m.MarketTypeId || m.Type || ''}=${m.Name || m.MarketName || ''}`).join(' | ').slice(0, 3000)}`;
    } catch {}
    show(`${p} HTTP ${r.status} (${t.length} chars)`, t + summary, 1200 + summary.length);
  } catch (e) {
    console.log(p, e.message);
  }
}
