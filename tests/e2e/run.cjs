// Prueba de punta a punta de la página con la extensión simulada.
// Uso: NODE_PATH=$(npm root -g) node tests/e2e/run.cjs [carpeta-capturas]
// Requiere Playwright (con Chromium) y Python 3 para servir docs/.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tests/e2e/capturas'));
const PORT = 8123;
const URL = `http://localhost:${PORT}/`;
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-extension.js'), 'utf8');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'OK ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', path.join(ROOT, 'docs')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-PE', timezoneId: 'America/Lima' });
    await context.addInitScript(MOCK);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    // 1) Partidos
    await page.goto(URL);
    await page.waitForSelector('.league');
    check('detecta la extensión', (await page.getAttribute('#ext-status .chip', 'title')).includes('9.9.9'));
    const leagues = await page.$$eval('.league .name', (els) => els.map((e) => e.textContent));
    check('muestra las ligas de fútbol ordenadas por importancia', leagues.join(',') === 'Premier League,Serie A,Liga 1', leagues.join(', '));
    const times = await page.$$eval('.league:has-text("Liga 1") .match .time', (els) => els.map((e) => e.textContent));
    check('partidos de cada liga ordenados por hora', times.join() === [...times].sort().join(), times.join(' '));
    await page.click('.league:has-text("Premier League") .league-head input');
    await page.click('.league:has-text("Liga 1") .league-head input');
    await page.click('.sport:has-text("Básquet")');
    await page.waitForSelector('.league:has-text("NBA")');
    await page.click('.league:has-text("NBA") .league-head input');
    await page.click('.sport:has-text("Tenis")');
    await page.waitForSelector('.league:has-text("ATP Tokyo")');
    await page.click('.league:has-text("ATP Tokyo") .league-head input');
    await page.click('.sport:has-text("Fútbol")');
    await page.waitForSelector('.match');
    const count = await page.textContent('#sel-count');
    check('marca ligas completas de varios deportes', count.startsWith('11 '), count);
    check('no deja marcar partidos ya empezados', await page.$eval('.league:has-text("Serie A") .league-head input', (el) => el.disabled));
    await page.screenshot({ path: path.join(OUT, '1-partidos.png'), fullPage: true });

    // 2) Análisis estadístico
    await page.click('#run-stats');
    await page.waitForSelector('#tab-analisis .summary h2', { timeout: 60000 });
    await page.waitForSelector('.chip:has-text("Guardado en el historial")', { timeout: 30000 });
    const summary = await page.textContent('#tab-analisis .summary');
    check('analiza los 11 partidos', summary.includes('11 partidos analizados'), summary.slice(0, 120));
    check('Apuesta Total emparejada', /Apuesta Total · \d+ partidos/.test(summary), summary.match(/Apuesta Total[^A-Z]*/)?.[0]);
    check('muestra el error de Betano sin romper el análisis', summary.includes('Betano: error'));
    const levels = await page.$$eval('#tab-analisis .card', (cards) => cards.map((c) => c.className));
    check(
      'hay picks por nivel y combinadas',
      levels.some((c) => c.includes('alta')) && levels.some((c) => c.includes('combo')),
      `${levels.length} tarjetas`,
    );
    const comboText = await page.$$eval('.card.combo .odds', (els) => els.map((e) => Number(e.textContent)));
    check('las combinadas alcanzan la cuota objetivo', comboText.length > 0 && comboText.every((o) => o >= 5), comboText.join(', '));
    await page.screenshot({ path: path.join(OUT, '2-analisis.png'), fullPage: true });
    await page.click('text=Copiar picks');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check('copia los picks como texto', copied.includes('Confianza') && copied.includes('@'), copied.split('\n').slice(0, 3).join(' | '));

    // 3) Historial
    await page.click('.tabs button[data-tab="historial"]');
    await page.waitForSelector('.day');
    check('el historial guarda el día con picks pendientes', (await page.textContent('.day')).includes('pendientes'));
    check('avisa que se guarda solo en el navegador', (await page.textContent('#tab-historial .banner')).includes('solo en este navegador'));

    // 4) Actualizar resultados (se adelanta el reloj para que los partidos hayan terminado)
    await page.evaluate(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 36 * 3600000;
    });
    await page.click('text=Actualizar resultados');
    await page.waitForFunction(() => /Resultados:|No hay partidos|No se pudieron/.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const toast = await page.textContent('#toast');
    check('liquida las apuestas con los resultados', /Resultados: \d+ apuestas liquidadas/.test(toast), toast);
    await page.waitForTimeout(500);
    await page.click('.day-head');
    await page.waitForSelector('.day-body .status-pill.won, .day-body .status-pill.lost');
    const pills = await page.$$eval('.day-body .status-pill', (els) => els.map((e) => e.textContent));
    check('marca ganadas y perdidas', pills.includes('Ganada') && pills.includes('Perdida') && !pills.includes('Pendiente'), `${pills.length} apuestas`);
    const table = await page.textContent('.panel table');
    check('calcula aciertos y ganancia por nivel', /%/.test(table), table.replace(/\s+/g, ' ').slice(0, 160));
    const netPanel = await page.textContent('.panel:has(h3:text-is("Red neuronal"))');
    check('la red neuronal registra los resultados para aprender', /105/.test(netPanel), netPanel.replace(/\s+/g, ' ').slice(0, 200));
    await page.screenshot({ path: path.join(OUT, '3-historial.png'), fullPage: true });

    // 5) Análisis con red neuronal
    await page.click('#run-nn');
    await page.waitForSelector('#tab-analisis .summary h2:has-text("red neuronal")', { timeout: 60000 });
    const nnBanner = await page.textContent('#tab-analisis .summary .banner');
    check('el análisis con red neuronal explica su estado', /105 de 200/.test(nnBanner), nnBanner.slice(0, 160));
    const tableOverflow = await page.evaluate(() => [...document.querySelectorAll('.panel')].some((p) => p.scrollWidth > p.clientWidth + 1));
    check('las tablas del historial caben en su panel', !tableOverflow);

    // 6) Celular
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(OUT, '4-celular-analisis.png'), fullPage: false });
    await page.click('.tabs button[data-tab="partidos"]');
    await page.screenshot({ path: path.join(OUT, '5-celular-partidos.png'), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('sin desplazamiento horizontal en celular', !overflow);

    // 7) Sin extensión: solo historial
    const plain = await browser.newPage();
    plain.on('pageerror', (e) => errors.push(`(sin extensión) ${e.message}`));
    await plain.goto(URL);
    await plain.waitForSelector('#tab-historial .banner', { timeout: 10000 });
    check('sin extensión abre el historial en modo lectura', (await plain.textContent('#tab-historial .banner')).includes('Solo lectura'));
    check('sin extensión los botones de análisis están desactivados', await plain.$eval('#run-stats', (b) => b.disabled));
  } finally {
    check('sin errores de JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
    server.kill();
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones correctas. Capturas en ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
})();
