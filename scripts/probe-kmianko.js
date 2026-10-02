// Explora el sportsbook de Apuesta Total (proveedor kmianko) para encontrar
// los endpoints de la lista completa de partidos de fútbol y sus cuotas.
const { chromium } = require('playwright');

const BASE = 'https://prod20392.kmianko.com/es-pe/spbkv3?operatorToken=logout';
const NOISE = /\.(svg|png|jpg|webp|woff2?|css|js)(\?|$)|cdn-cgi|assets-hashes|announcement|match-tracker|trpc\//;

function shape(v, depth = 0, max = 5) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return depth >= max ? `[…×${v.length}]` : `[${shape(v[0], depth + 1, max)}]×${v.length}`;
  }
  if (typeof v === 'object') {
    if (depth >= max) return '{…}';
    const keys = Object.keys(v);
    const parts = keys.slice(0, 30).map((k) => `${k}:${shape(v[k], depth + 1, max)}`);
    if (keys.length > 30) parts.push(`…+${keys.length - 30}`);
    return `{${parts.join(', ')}}`;
  }
  if (typeof v === 'string') return `"${v.slice(0, 50)}"`;
  return String(v);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 } });
  const seen = new Map();
  let phase = 'inicio';
  page.on('response', async (r) => {
    const url = r.url();
    if (!url.includes('kmianko.com/api/') || NOISE.test(url)) return;
    let body = '';
    try {
      body = (await r.body()).toString('utf8');
    } catch {}
    const key = url.split('?')[0];
    if (seen.has(key)) return;
    let structure = '';
    try {
      structure = shape(JSON.parse(body)).slice(0, 2500);
    } catch {
      structure = body.slice(0, 300).replace(/\s+/g, ' ');
    }
    seen.set(key, true);
    console.log(`\n[${phase}] ${r.status()} ${body.length}B ${url.slice(0, 900)}\n  ${structure}`);
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);

  for (const label of ['Fútbol', 'Hoy', '24h']) {
    phase = label;
    try {
      await page.getByText(label, { exact: true }).first().click({ timeout: 8000 });
      console.log(`\n>>> clic en "${label}" -> ${page.url()}`);
    } catch (e) {
      console.log(`\n>>> no se pudo hacer clic en "${label}": ${e.message.split('\n')[0]}`);
    }
    await page.waitForTimeout(8000);
  }
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /futbol|soccer|football|event|league/i.test(h)).slice(0, 30),
  );
  console.log('\nenlaces:', JSON.stringify(links));
  await browser.close();
})();
