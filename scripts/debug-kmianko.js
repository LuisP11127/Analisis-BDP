// Temporal: verifica cómo obtener la sesión anónima de kmianko.
const { chromium } = require('playwright');
const BASE = 'https://prod20392.kmianko.com';
const PAGE = `${BASE}/es-pe/spbkv3?operatorToken=logout`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

(async () => {
  // 1) Node: cargar la página, tomar cookies y pedir cuotas con ellas.
  const page = await fetch(PAGE, { headers: { 'User-Agent': UA } });
  const setCookies = page.headers.getSetCookie();
  console.log('set-cookie en la página:', setCookies.map((c) => c.split(';').map((p, i) => (i === 0 ? p.split('=')[0] : p.trim())).join('; ')));
  const jar = Object.fromEntries(setCookies.map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const snap = await (await fetch(`${BASE}/api/pulse/snapshot/events?lang=ES-PE&t=hPNl`)).json();
  const ids = snap.filter((e) => e.SportId === '1' && !e.IsLive).slice(0, 5).map((e) => e._id);
  const q = encodeURIComponent(`${ids.join('|')}:ML0|ML39|OU200|OU249|QA61|QA158`);
  const variants = {
    sinNada: {},
    soloCookie: { Cookie: `session=${jar.session}; authorization=${jar.authorization}` },
    encabezados: { authorization: jar.authorization, session: jar.session, 'time-area': '01' },
    ambos: { Cookie: `session=${jar.session}; authorization=${jar.authorization}`, authorization: jar.authorization, session: jar.session, 'time-area': '01' },
  };
  for (const [name, headers] of Object.entries(variants)) {
    const r = await fetch(`${BASE}/api/eventlist/eu/markets/all?markets=${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: PAGE, ...headers } });
    const t = await r.text();
    let n = '';
    try { n = `${JSON.parse(t).length} mercados`; } catch {}
    console.log(`variante ${name}: ${r.status} ${n} ${n ? '' : t.slice(0, 150)}`);
  }

  // 2) Navegador: ¿puede el JavaScript de la página leer esas cookies?
  const browser = await chromium.launch();
  const p = await browser.newPage();
  await p.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(8000);
  const info = await p.evaluate(() => ({
    documentCookie: document.cookie.split(';').map((c) => c.split('=')[0].trim()),
    localStorage: Object.keys(localStorage),
    sessionStorage: Object.keys(sessionStorage),
  }));
  console.log('en la página:', JSON.stringify(info));
  console.log('cookies (httpOnly):', JSON.stringify((await p.context().cookies()).map((c) => `${c.name} httpOnly=${c.httpOnly}`)));
  await browser.close();
})();
