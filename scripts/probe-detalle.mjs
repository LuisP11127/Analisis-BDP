// Exploración temporal (3): códigos de los tipos de mercado de Apuesta Total.
// Pide, para un evento de cada deporte, los tipos ML/OU/HC/QA del 0 al 999 y
// lista los que existen con su nombre.
const AT = 'https://prod20392.kmianko.com';
const page = await fetch(`${AT}/es-pe/spbkv3?operatorToken=logout`, { signal: AbortSignal.timeout(25000) });
const jar = {};
for (const c of page.headers.getSetCookie?.() || []) {
  const p = c.split(';')[0];
  jar[p.slice(0, p.indexOf('='))] = p.slice(p.indexOf('=') + 1);
}
const ath = { 'time-area': '01', ...(jar.authorization ? { authorization: jar.authorization, session: jar.session } : {}) };
const evs = await (await fetch(`${AT}/api/pulse/snapshot/events?lang=ES-PE&t=hPNl`, { headers: ath })).json();
const sports = ['Fútbol', 'Baloncesto', 'Tenis', 'Ice Hockey', 'Béisbol', 'Fútbol Americano', 'Voleibol', 'Balonmano', 'Tenis de Mesa', 'E-sports+', 'MMA', 'Dardos'];
const prefixes = ['ML', 'OU', 'HC', 'QA'];
for (const sport of sports) {
  const ev = evs.filter((e) => e.SportName === sport && !e.IsLive).sort((a, b) => b.TotalMarketsCount - a.TotalMarketsCount)[0];
  if (!ev) {
    console.log(`\n=== ${sport}: sin eventos`);
    continue;
  }
  const found = [];
  for (const prefix of prefixes) {
    for (let start = 0; start < 1000; start += 125) {
      const types = Array.from({ length: 125 }, (_, i) => `${prefix}${start + i}`);
      try {
        const r = await fetch(`${AT}/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${ev._id}:${types.join('|')}`)}`, { headers: ath, signal: AbortSignal.timeout(30000) });
        const list = await r.json();
        for (const m of Array.isArray(list) ? list : []) {
          found.push(`${m.MarketType?._id}=${m.Name} [${(m.Selections || []).slice(0, 4).map((s) => `${s.Name}${s.QAParam1 ? `(${s.QAParam1})` : ''} ${s.TrueOdds}`).join('; ')}]`);
        }
      } catch (e) {
        found.push(`${prefix}${start}: ${e.message}`);
      }
    }
  }
  console.log(`\n=== ${sport}: ${ev.EventName} (${ev.TotalMarketsCount} mercados; encontrados ${found.length})`);
  for (const f of found) console.log('  ' + f.slice(0, 260));
}
