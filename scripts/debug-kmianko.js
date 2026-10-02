// Temporal: captura los encabezados de las llamadas de cuotas de kmianko.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-PE', timezoneId: 'America/Lima' });
  const want = /eventlist\/eu\/markets|auth\/signToken|snapshot\/events/;
  page.on('request', async (r) => {
    if (!want.test(r.url())) return;
    console.log(`\n>>> ${r.method()} ${r.url().slice(0, 300)}`);
    console.log('headers: ' + JSON.stringify(await r.allHeaders()));
    if (r.postData()) console.log('body: ' + r.postData().slice(0, 500));
  });
  page.on('response', async (r) => {
    if (!want.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch {}
    console.log(`<<< ${r.status()} ${r.url().slice(0, 120)} set-cookie=${JSON.stringify(r.headers()['set-cookie'] || '')}\n    ${r.url().includes('signToken') ? body : ''}`);
  });
  await page.goto('https://prod20392.kmianko.com/es-pe/spbkv3?operatorToken=logout', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000);
  console.log('\ncookies: ' + JSON.stringify((await page.context().cookies()).map((c) => `${c.name}@${c.domain}`)));
  await browser.close();
})();
