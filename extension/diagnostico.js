// Página de diagnóstico: prueba cada fuente y arma un reporte para compartir.
const $ = (sel) => document.querySelector(sel);
const results = {};

function send(action, params) {
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage({ action, params }, (reply) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      reply?.ok ? resolve(reply.data) : reject(new Error(reply?.error || 'Sin respuesta'));
    }),
  );
}

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (node.className = v) : node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const round2 = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);

// Una línea legible por cada tipo de dato que devuelven las fuentes.
function describe(item) {
  if (item.markets) {
    const m = item.markets[0];
    const odds = m ? `${m.name}: ${m.selections.map((s) => `${s.name} ${s.price}`).join(' · ')}` : 'sin mercados';
    return `${fmtTime(item.start)} · ${item.league} · ${item.home} vs ${item.away} — ${odds} (${item.markets.length} mercados)`;
  }
  if (item.home !== undefined) {
    const score = item.score ? ` ${item.score.home ?? '-'}-${item.score.away ?? '-'}` : '';
    return `${fmtTime(item.start)} · ${item.league}${item.country ? ` (${item.country})` : ''} · ${item.home} vs ${item.away}${score} [${item.status}]`;
  }
  if (item.team) return `${item.team}: xG a favor ${round2(item.xgFor)} · xG en contra ${round2(item.xgAgainst)} · ${item.points} pts`;
  if (item.title) return `${item.title}${item.published ? ` (${fmtTime(item.published)})` : ''}`;
  return JSON.stringify(item).slice(0, 200);
}

const MODE = { direct: 'directo', tab: 'en pestaña del sitio' };

function render(source) {
  const r = results[source.id];
  const card = $(`#card-${source.id}`);
  const badge = card.querySelector('.badge');
  const body = card.querySelector('.body');
  body.replaceChildren();
  if (!r) {
    badge.className = 'badge';
    badge.textContent = 'Sin probar';
    return;
  }
  if (r.running) {
    badge.className = 'badge run';
    badge.textContent = 'Probando…';
    return;
  }
  badge.className = `badge ${r.ok ? 'ok' : 'err'}`;
  badge.textContent = r.ok ? `Funciona · ${r.count} resultados` : 'Error';
  body.append(el('div', { class: 'meta' }, `${(r.ms / 1000).toFixed(1)} s${r.mode ? ` · modo ${MODE[r.mode] || r.mode}` : ''}`));
  if (r.ok) {
    body.append(el('ul', { class: 'rows' }, (r.sample || []).map((item) => el('li', {}, describe(item)))));
  } else {
    body.append(el('div', { class: 'error' }, `${r.error}${r.status ? ` (HTTP ${r.status})` : ''}`));
    if (r.snippet) body.append(el('div', { class: 'meta' }, `Respuesta: ${r.snippet}`));
  }
  body.append(el('details', {}, el('summary', {}, 'Ver datos técnicos'), el('pre', {}, JSON.stringify(r, null, 2))));
}

async function run(source) {
  results[source.id] = { running: true };
  render(source);
  try {
    results[source.id] = await send('diagnose', { source: source.id });
  } catch (e) {
    results[source.id] = { id: source.id, name: source.name, ok: false, error: e.message, ms: 0 };
  }
  render(source);
  $('#copy').disabled = $('#download').disabled = false;
}

function report() {
  return JSON.stringify(
    {
      generado: new Date().toISOString(),
      version: chrome.runtime.getManifest().version,
      navegador: navigator.userAgent,
      resultados: Object.values(results).filter((r) => !r.running),
    },
    null,
    2,
  );
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

(async () => {
  $('#version').textContent = `v${chrome.runtime.getManifest().version}`;
  const sources = await send('sources');
  for (const s of sources) {
    const button = el('button', {}, 'Probar');
    button.addEventListener('click', () => run(s));
    $('#list').append(
      el(
        'div',
        { class: 'card', id: `card-${s.id}` },
        el('div', { class: 'head' }, el('span', { class: 'name' }, s.name), el('span', { class: 'role' }, s.role), el('span', { class: 'badge' }, 'Sin probar'), button),
        el('div', { class: 'body' }),
      ),
    );
  }
  $('#run-all').addEventListener('click', async () => {
    $('#run-all').disabled = true;
    for (const s of sources) await run(s); // una a una, para no abrir varias pestañas a la vez
    $('#run-all').disabled = false;
  });
  $('#copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(report());
    toast('Reporte copiado');
  });
  $('#download').addEventListener('click', () => {
    const a = el('a', { href: URL.createObjectURL(new Blob([report()], { type: 'application/json' })), download: 'diagnostico-bdp.json' });
    a.click();
  });
})();
