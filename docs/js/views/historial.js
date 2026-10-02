// Pestaña "Historial": seguimiento por separado del análisis estadístico y del
// de red neuronal (aciertos, ganancia y ROI por nivel y de las combinadas),
// apuestas guardadas por día y estado de la red neuronal.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { BOOKMAKERS, LEVELS } from '../analysis/picks.js';
import { emptyMethodStats, hitRate, roi, totals } from '../history.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtDay, fmtTime, h, pct } from '../util.js';

const STATUS = { won: 'Ganada', lost: 'Perdida', void: 'Nula', pending: 'Pendiente' };
const LEVEL_NAME = Object.fromEntries(LEVELS.map((l) => [l.id, l.name]));
const METHODS = [
  ['estadistico', 'Análisis estadístico', 'Estadístico'],
  ['red_neuronal', 'Análisis con red neuronal', 'Red neuronal'],
];
const SHORT = Object.fromEntries(METHODS.map(([id, , short]) => [id, short]));
const ZERO = { won: 0, lost: 0, pending: 0, staked: 0, profit: 0 };

const money = (x) => h('span', { class: x > 0 ? 'pos' : x < 0 ? 'neg' : '' }, `${x > 0 ? '+' : ''}${x.toFixed(2)} u`);
const pill = (status) => h('span', { class: `status-pill ${status}` }, STATUS[status] || status);

function statsRow(name, s, cls = '') {
  const hr = hitRate(s);
  const r = roi(s);
  return h(
    'tr',
    { class: cls },
    h('td', {}, name),
    h('td', { class: 'num' }, `${s.won + s.lost}`),
    h('td', { class: 'num' }, hr == null ? '–' : pct(hr)),
    h('td', { class: 'num' }, s.staked ? money(s.profit) : '–'),
    h('td', { class: 'num' }, r == null ? '–' : `${r > 0 ? '+' : ''}${Math.round(r * 100)}%`),
    h('td', { class: 'num hide-sm' }, `${s.pending}`),
  );
}

function statsTable(rows) {
  return h('div', { class: 'table-wrap' }, statsTableInner(rows));
}

function statsTableInner(rows) {
  return h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, ''),
        h('th', { class: 'num' }, 'Resueltas'),
        h('th', { class: 'num' }, 'Aciertos'),
        h('th', { class: 'num' }, 'Ganancia'),
        h('th', { class: 'num' }, 'ROI'),
        h('th', { class: 'num hide-sm' }, 'Pendientes'),
      ),
    ),
    h('tbody', {}, rows),
  );
}

// Resultados de un método: por nivel, combinadas y total de picks.
function methodPanel(title, m = emptyMethodStats()) {
  return h(
    'div',
    { class: 'panel' },
    h('h3', {}, title),
    statsTable([
      ...LEVELS.map((l) => statsRow(l.name, m.byLevel[l.id] || ZERO)),
      statsRow('Combinadas', m.combos),
      statsRow('Total picks', m, 'total'),
    ]),
  );
}

function storageBanner(app) {
  const { mode, info, tokenError } = app.storage;
  if (mode === 'github-web' || mode === 'github')
    return h(
      'div',
      { class: 'banner' },
      h('b', {}, 'Guardando en GitHub: '),
      `${info.repo} (rama ${info.branch}). Lo ves desde cualquier dispositivo donde hayas pegado tu token.`,
    );
  const settings = h('button', { class: 'btn small', onclick: () => document.querySelector('#open-settings').click() }, '⚙ Pegar token');
  if (mode === 'local')
    return h(
      'div',
      { class: 'banner warn' },
      h('b', {}, tokenError ? `El token de GitHub no funciona (${tokenError}). ` : 'Guardando solo en este navegador. '),
      'Para verlo en el celular y en la PC y no perderlo, pega tu token de GitHub en Ajustes. ',
      settings,
    );
  return h('div', { class: 'banner warn' }, h('b', {}, 'Este navegador no permite guardar datos '), '(¿modo incógnito?). Pega tu token de GitHub para guardar en el repositorio. ', settings);
}

function networkPanel(app) {
  const net = app.state.network;
  const m = net?.meta || {};
  const body = [];
  if (net?.trained) {
    body.push(h('p', {}, `Entrenada con ${m.samples} resultados (${fmtDateTime(Date.parse(m.trainedAt))}).`));
    if (m.baseLoss != null) {
      const better = ((m.baseLoss - m.nnLoss) / m.baseLoss) * 100;
      body.push(
        h(
          'p',
          { class: 'note' },
          `En los ${m.validation} resultados más recientes (no usados para entrenar), el error de la red es ${better.toFixed(1)}% menor que el del análisis estadístico. Aciertos: ${pct(m.baseAccuracy)} → ${pct(m.nnAccuracy)}.`,
        ),
      );
    }
  } else {
    body.push(
      h(
        'p',
        {},
        m.samples
          ? m.reason || `Con ${m.samples} resultados todavía no mejora al análisis estadístico; sigue aprendiendo.`
          : `Aún sin entrenar: necesita al menos ${MIN_SAMPLES} selecciones con resultado.`,
      ),
    );
    body.push(h('p', { class: 'note' }, 'Cada análisis guarda todas las selecciones evaluadas; al actualizar resultados la red se reentrena con ellas.'));
  }
  return h(
    'div',
    { class: 'panel' },
    h('h3', {}, 'Entrenamiento de la red neuronal'),
    body,
    app.storage.mode !== 'lectura' ? h('button', { class: 'btn small', onclick: () => app.retrain() }, 'Reentrenar ahora') : null,
  );
}

function legLine(l, extra = []) {
  const sport = sportOf(l.sport);
  const score = l.score ? ` · ${l.score.homeNT ?? l.score.home}-${l.score.awayNT ?? l.score.away}` : '';
  return h(
    'li',
    {},
    pill(l.status),
    ...extra,
    h('span', {}, `${sport.icon} ${l.match} (${fmtTime(l.start)}): `),
    h('b', {}, l.label),
    h('span', { class: 'note' }, score),
  );
}

function dayBody(day, filter) {
  if (!day) return h('div', { class: 'note' }, 'No se encontró el detalle de este día.');
  const list = day.analyses.filter((a) => filter === 'ambos' || a.method === filter);
  if (!list.length) return h('div', { class: 'note' }, `Sin análisis ${SHORT[filter]?.toLowerCase() || ''} este día.`);
  return list
    .slice()
    .reverse()
    .map((a) =>
      h(
        'div',
        { class: 'analysis-block' },
        h(
          'h4',
          {},
          h('span', { class: `method-tag ${a.method}` }, SHORT[a.method] || a.method),
          ` ${fmtDateTime(Date.parse(a.created))} · ${Object.keys(a.events || {}).length} partidos`,
        ),
        a.picks.length
          ? h(
              'ul',
              { class: 'leg-list' },
              a.picks.map((p) =>
                legLine(p, [
                  h('span', { class: 'lvl', style: `color:var(--${p.level === 'alta' ? 'alta' : p.level === 'moderada_alta' ? 'modalta' : 'mod'})` }, LEVEL_NAME[p.level]),
                  h('span', { class: 'note' }, `@ ${p.odds.toFixed(2)} ${BOOKMAKERS[p.source]} · ${pct(p.p)}`),
                ]),
              ),
            )
          : h('div', { class: 'note' }, 'Sin picks.'),
        (a.combos || []).map((k) =>
          h(
            'div',
            {},
            h('div', { class: 'note' }, pill(k.status), ` Combinada ${BOOKMAKERS[k.source]} · cuota ${k.odds.toFixed(2)} · prob. ${pct(k.p)}`),
            h('ul', { class: 'leg-list' }, k.legs.map((l) => legLine(l, [h('span', { class: 'note' }, `@ ${l.price.toFixed(2)}`)]))),
          ),
        ),
      ),
    );
}

export function renderHistorial(root, app) {
  const { state } = app;
  root.replaceChildren();
  root.append(storageBanner(app));
  const actions = h(
    'div',
    { class: 'toolbar' },
    h('button', { class: 'btn primary', disabled: app.storage.mode === 'lectura', onclick: () => app.updateResults() }, 'Actualizar resultados'),
    app.storage.mode.startsWith('github') && state.localFiles > 0
      ? h('button', { class: 'btn', onclick: () => app.uploadLocal() }, `Subir a GitHub lo guardado en el navegador (${state.localFiles})`)
      : null,
    h('button', { class: 'btn small ghost', onclick: () => app.reloadHistory() }, '↻'),
  );
  root.append(actions);

  const index = state.index || { days: {} };
  const t = totals(index);
  root.append(
    h(
      'div',
      { class: 'grid2' },
      METHODS.map(([id, title]) => methodPanel(title, t.methods[id])),
      networkPanel(app),
    ),
  );

  const dates = Object.keys(index.days).sort().reverse();
  if (!dates.length) {
    root.append(h('div', { class: 'empty' }, 'Todavía no hay análisis guardados. Cada análisis que hagas se guarda aquí con sus resultados.'));
    return;
  }
  const filter = state.histMethod || 'ambos';
  root.append(
    h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'note' }, 'Detalle de cada día:'),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Análisis a mostrar en cada día' },
        [['ambos', 'Ambos'], ...METHODS.map(([id, , short]) => [id, short])].map(([id, name]) =>
          h('button', { class: id === filter ? 'active' : '', onclick: () => app.setHistMethod(id) }, name),
        ),
      ),
    ),
  );
  for (const date of dates) {
    const s = index.days[date];
    const open = state.openDays.has(date);
    const lines = s.methods ? METHODS.filter(([id]) => s.methods[id] && (filter === 'ambos' || filter === id)).map(([id]) => [SHORT[id], s.methods[id]]) : [['', s]];
    const head = h(
      'button',
      { class: 'day-head', onclick: () => app.toggleDay(date) },
      h('span', { class: 'date' }, fmtDay(date)),
      h(
        'span',
        { class: 'day-lines' },
        lines.map(([name, m]) =>
          h(
            'span',
            { class: 'day-line' },
            name ? h('b', {}, name) : null,
            h('span', { class: 'chip' }, `${m.n} picks`),
            m.won ? h('span', { class: 'chip ok' }, `${m.won} ganadas`) : null,
            m.lost ? h('span', { class: 'chip err' }, `${m.lost} perdidas`) : null,
            m.pending ? h('span', { class: 'chip' }, `${m.pending} pendientes`) : null,
            m.staked ? money(m.profit) : null,
          ),
        ),
      ),
    );
    const box = h('div', { class: 'day' }, head);
    if (open) box.append(h('div', { class: 'day-body' }, state.dayCache.has(date) ? dayBody(state.dayCache.get(date), filter) : h('div', { class: 'note' }, 'Cargando…')));
    root.append(box);
  }
}
