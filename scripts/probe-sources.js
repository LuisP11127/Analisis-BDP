// Prueba de acceso a las fuentes de datos (Sofascore, Betano, Apuesta Total).
// Abre cada sitio en Chromium, registra el estado HTTP, el texto visible y las
// llamadas XHR/fetch/WebSocket que hace la página, para saber de dónde salen
// los datos y si el sitio bloquea la conexión.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.env.PROBE_OUT || 'probe-output';
const EXTRA_ARGS = (process.env.EXTRA_CHROMIUM_ARGS || '').split(' ').filter(Boolean);
const WAIT_MS = Number(process.env.PROBE_WAIT_MS || 15000);

const targets = [
  { name: 'sofascore', url: 'https://www.sofascore.com/es/futbol' },
  { name: 'betano', url: 'https://www.betano.pe/sport/futbol/' },
  { name: 'apuestatotal-iframe', url: 'https://prod20392.kmianko.com/es-pe/spbkv3?operatorToken=logout' },
  { name: 'flashscore', url: 'https://www.flashscore.com/' },
  { name: 'flashscore-pe', url: 'https://www.flashscore.pe/' },
  { name: 'fotmob', url: 'https://www.fotmob.com/es' },
];

// Forma resumida de un JSON: claves, tipos y primer elemento de cada lista.
function shape(v, depth = 0, max = 4) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return depth >= max ? `[…×${v.length}]` : `[${shape(v[0], depth + 1, max)}]×${v.length}`;
  }
  if (typeof v === 'object') {
    if (depth >= max) return '{…}';
    const keys = Object.keys(v);
    const parts = keys.slice(0, 25).map((k) => `${k}:${shape(v[k], depth + 1, max)}`);
    if (keys.length > 25) parts.push(`…+${keys.length - 25}`);
    return `{${parts.join(', ')}}`;
  }
  if (typeof v === 'string') return `"${v.slice(0, 40)}"`;
  return String(v);
}

// Respuestas de seguimiento/publicidad que no aportan datos deportivos.
const NOISE = /google|doubleclick|facebook|criteo|optimove|crazyegg|tiktok|stackadapt|adform|rfihub|cdn-cgi|mida\.so|instana|hotjar|clarity|onetrust|cookielaw/;

const isData = (type) => type === 'xhr' || type === 'fetch' || type === 'document';

async function probe(browser, { name, url }) {
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();
  const calls = [];
  const sockets = [];
  const failed = {};

  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('requestfailed', (r) => {
    failed[new URL(r.url()).host] = r.failure()?.errorText;
  });
  page.on('response', async (r) => {
    const type = r.request().resourceType();
    if (!isData(type)) return;
    let body = '';
    try {
      body = (await r.body()).toString('utf8');
    } catch {}
    const ctype = r.headers()['content-type'] || '';
    if (NOISE.test(r.url())) return;
    let structure = '';
    try {
      structure = shape(JSON.parse(body)).slice(0, 1500);
    } catch {}
    calls.push({
      status: r.status(),
      type,
      size: body.length,
      json: Boolean(structure),
      url: r.url(),
      fsign: r.request().headers()['x-fsign'] || '',
      sample: structure || (type === 'document' ? '' : body.slice(0, 400).replace(/\s+/g, ' ')),
    });
  });

  let status = 'n/a';
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    status = resp ? resp.status() : 'sin respuesta';
    await page.waitForTimeout(WAIT_MS);
  } catch (e) {
    status = 'ERROR ' + e.message.split('\n')[0];
  }

  const title = await page.title().catch(() => '');
  const text = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).replace(/\s+/g, ' ');
  const iframes = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src)).catch(() => []);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
  await ctx.close();

  const jsonCalls = calls.filter((c) => c.json);
  const lines = [
    `\n===== ${name} — ${url}`,
    `estado=${status}  titulo=${JSON.stringify(title)}`,
    `texto (500 car.): ${text.slice(0, 500)}`,
    `iframes: ${JSON.stringify(iframes)}`,
    `websockets: ${JSON.stringify(sockets)}`,
    `fallidas: ${JSON.stringify(failed)}`,
    `llamadas de datos: ${calls.length} (JSON: ${jsonCalls.length})`,
    ...calls.slice(0, 40).map((c) => `  ${c.status} ${c.type} ${c.size}B ${c.json ? '[json] ' : ''}${c.fsign ? '[x-fsign=' + c.fsign + '] ' : ''}${c.url.slice(0, 400)}`),
    ...calls
      .filter((c) => c.sample && c.size > 200)
      .sort((a, b) => b.size - a.size)
      .slice(0, 8)
      .map((c) => `  muestra ${c.url.slice(0, 200)}\n    ${c.sample}`),
  ];
  return { name, status, title, jsonCount: jsonCalls.length, textLength: text.length, log: lines.join('\n') };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled', ...EXTRA_ARGS],
  });
  const results = [];
  for (const t of targets) {
    const r = await probe(browser, t);
    console.log(r.log);
    results.push(r);
  }
  await browser.close();

  const summary = [
    '| Sitio | Estado | Título | Texto visible | Respuestas JSON |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.status} | ${r.title.replace(/\|/g, '/')} | ${r.textLength} car. | ${r.jsonCount} |`),
  ].join('\n');
  console.log('\n' + summary);
  fs.writeFileSync(path.join(OUT, 'summary.md'), summary + '\n');
})();
