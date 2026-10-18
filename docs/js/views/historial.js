// Pestaña "Historial": seguimiento por separado del análisis estadístico, del
// de red neuronal y de las random bets (aciertos, ganancia y ROI por nivel y de
// las combinadas), apuestas guardadas por día, sorteo de random bets y estado
// de la red neuronal.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { BOOKMAKERS, LEVELS } from '../analysis/picks.js';
import { RANDOM, emptyMethodStats, hitRate, roi, totals } from '../history.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtDay, fmtTime, h, limaDateOf, limaToday, pct } from '../util.js';

const STATUS = { won: 'Ganada', lost: 'Perdida', void: 'Nula', pending: 'Pendiente', half_won: 'Medio ganada', half_lost: 'Medio perdida' };
const LEVEL_NAME = Object.fromEntries(LEVELS.map((l) => [l.id, l.name]));
const METHODS = [
  ['estadistico', 'Análisis estadístico', 'Estadístico'],
  ['red_neuronal', 'Análisis con red neuronal', 'Red neuronal'],
  [RANDOM, 'Random bets', 'Random'],
];
export const RANDOM_MAX = 50; // apuestas por sorteo
const SHORT = Object.fromEntries(METHODS.map(([id, , short]) => [id, short]));
const ZERO = { won: 0, lost: 0, pending: 0, staked: 0, profit: 0 };

const LEVEL_SHORT = { alta: 'Alta', moderada_alta: 'Mod-alta', moderada: 'Moderada' };

// Porcentaje de acertadas de las resueltas: " · 75%" (nada si aún no hay resueltas).
const hitPct = (st) => {
  const hr = hitRate(st);
  return hr == null ? null : h('span', { class: 'hit-pct' }, ` · ${pct(hr)}`);
};

// Aciertos de un día por nivel de confianza: "Alta 3/4 · 75%" (acertadas / resueltas).
function levelChips(m) {
  const items = [...LEVELS.map((l) => [l.id, LEVEL_SHORT[l.id] || l.name, m.byLevel?.[l.id]]), ['combo', 'Combinadas', m.combos]];
  return items
    .filter(([, , st]) => st?.n)
    .map(([id, name, st]) => {
      const resolved = st.won + st.lost;
      const title = `${name}: ${st.won} acertadas de ${resolved} resueltas${resolved ? ` (${pct(st.won / resolved)})` : ''}${st.pending ? `, ${st.pending} pendientes` : ''}${st.void ? `, ${st.void} nulas` : ''}`;
      return h('span', { class: `chip lvl lvl-${id}`, title }, h('span', { class: 'lvl-name' }, name), ` ${st.won}/${resolved}`, hitPct(st), st.pending ? h('span', { class: 'note' }, ` +${st.pending}`) : null);
    });
}

// Tabla del día por nivel (al abrir el día).
function dayTables(s, filter) {
  if (!s?.methods) return null;
  const list = METHODS.filter(([id]) => s.methods[id] && (filter === 'ambos' || filter === id));
  if (!list.length) return null;
  return h(
    'div',
    { class: 'day-tables' },
    list.map(([id]) => {
      const m = s.methods[id];
      return h('div', { class: 'day-table' }, h('h4', {}, `${SHORT[id]}: aciertos del día por nivel`), statsTable(levelRows(m, id !== RANDOM)));
    }),
  );
}

// Filas por nivel, combinadas (las random bets no tienen) y total de picks.
const levelRows = (m, combos = true) => [
  ...LEVELS.map((l) => statsRow(l.name, m.byLevel?.[l.id] || ZERO)),
  combos ? statsRow('Combinadas', m.combos || ZERO) : null,
  statsRow('Total picks', m, 'total'),
];

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
function methodPanel(id, title, m = emptyMethodStats()) {
  return h('div', { class: 'panel' }, h('h3', {}, title), statsTable(levelRows(m, id !== RANDOM)));
}

// ---- Random bets ----

const ORDER = METHODS.map(([id]) => id);
const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
const joinY = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] || '');
// "Estadístico y Red neuronal": los análisis que dieron un pick.
const methodNames = (ids = []) => joinY([...ids].sort((a, b) => rank(a) - rank(b)).map((id) => SHORT[id] || id));
// Hora del partido; con la fecha si no es hoy.
const whenOf = (ms) => (limaDateOf(ms) === limaToday() ? fmtTime(ms) : fmtDateTime(ms));
const levelTag = (level) => h('span', { class: 'lvl', style: `color:var(--${level === 'alta' ? 'alta' : level === 'moderada_alta' ? 'modalta' : 'mod'})` }, LEVEL_NAME[level]);

// Texto para copiar las apuestas sorteadas.
export function randomText(draw) {
  const lines = [`Random bets · ${draw.picks.length} apuestas al azar`];
  for (const p of draw.picks) lines.push(`• ${p.match} (${whenOf(p.start)}): ${p.label} @ ${p.odds.toFixed(2)} ${BOOKMAKERS[p.source]} · ${pct(p.p)}`);
  return lines.join('\n');
}

// Número de apuestas y botón para sortear (en la barra del Historial).
function randomControls(app) {
  const input = h('input', {
    type: 'number',
    min: 1,
    max: RANDOM_MAX,
    step: 1,
    value: app.state.randomN,
    'aria-label': 'Número de apuestas a sortear',
    oninput: (e) => (app.state.randomN = e.target.value),
    onkeydown: (e) => e.key === 'Enter' && app.drawRandom(input.value),
  });
  return h(
    'span',
    { class: 'random-ctl' },
    h('label', {}, 'Apuestas', input),
    h('button', { class: 'btn rnd', title: 'Sortea apuestas al azar entre los picks de todos los análisis guardados', onclick: () => app.drawRandom(input.value) }, '🎲 Random bets'),
  );
}

// Las apuestas del último sorteo, para guardarlas en el seguimiento.
function randomPanel(app) {
  const d = app.state.randomDraw;
  if (!d) return null;
  const close = h('button', { class: 'btn small ghost', onclick: () => app.closeRandom() }, 'Cerrar');
  if (!d.picks.length)
    return h(
      'div',
      { class: 'panel random-draw' },
      h('h3', {}, '🎲 Random bets'),
      h('p', { class: 'note' }, 'No hay apuestas para sortear: los análisis guardados no tienen picks de partidos que aún no empiezan (o ya salieron todos en un sorteo). Haz un análisis y vuelve a intentar.'),
      close,
    );
  return h(
    'div',
    { class: 'panel random-draw' },
    h('h3', {}, `🎲 Random bets: ${d.picks.length} ${d.picks.length === 1 ? 'apuesta' : 'apuestas'} al azar`),
    h(
      'p',
      { class: 'note' },
      `Sorteadas entre ${d.pool} ${d.pool === 1 ? 'pick' : 'picks'} de los análisis guardados (${methodNames(d.methods).toLowerCase()}) de partidos que aún no empiezan, sin repetir y primero una por partido.`,
      d.picks.length < d.requested ? ` Pediste ${d.requested}, pero solo había ${d.picks.length}.` : '',
    ),
    h(
      'ul',
      { class: 'leg-list' },
      d.picks.map((p) =>
        h(
          'li',
          {},
          levelTag(p.level),
          h('span', {}, `${sportOf(p.sport).icon} ${p.match} (${whenOf(p.start)}): `),
          h('b', {}, p.label),
          h('span', { class: 'note' }, `@ ${p.odds.toFixed(2)} ${BOOKMAKERS[p.source]} · ${pct(p.p)} · ${methodNames(p.methods)}`),
        ),
      ),
    ),
    h(
      'div',
      { class: 'toolbar random-actions' },
      h(
        'button',
        {
          class: 'btn primary',
          disabled: !app.canSave(),
          title: app.canSave() ? 'Se liquidan con "Actualizar resultados" y se siguen aparte, como los otros análisis' : 'Este navegador no permite guardar',
          onclick: () => app.saveRandom(),
        },
        'Guardar en el seguimiento',
      ),
      h('button', { class: 'btn', onclick: () => app.redrawRandom() }, '🎲 Volver a sortear'),
      h('button', { class: 'btn', onclick: () => app.copyRandom() }, 'Copiar'),
      close,
    ),
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
    l.noData ? h('span', { class: 'note' }, ' · sin datos para liquidarla') : null,
  );
}

function dayBody(day, filter) {
  if (!day) return h('div', { class: 'note' }, 'No se encontró el detalle de este día.');
  const list = day.analyses.filter((a) => filter === 'ambos' || a.method === filter);
  if (!list.length) return h('div', { class: 'note' }, filter === RANDOM ? 'Sin random bets este día.' : `Sin análisis ${SHORT[filter]?.toLowerCase() || ''} este día.`);
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
          ` ${fmtDateTime(Date.parse(a.created))} · `,
          a.method === RANDOM ? `${a.picks.length} apuestas sorteadas entre ${a.draw?.pool ?? a.picks.length} picks` : `${Object.keys(a.events || {}).length} partidos`,
        ),
        a.picks.length
          ? h(
              'ul',
              { class: 'leg-list' },
              a.picks.map((p) =>
                legLine(p, [
                  levelTag(p.level),
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
    randomControls(app),
    app.storage.mode.startsWith('github') && state.localFiles > 0
      ? h('button', { class: 'btn', onclick: () => app.uploadLocal() }, `Subir a GitHub lo guardado en el navegador (${state.localFiles})`)
      : null,
    h('button', { class: 'btn small ghost', onclick: () => app.reloadHistory() }, '↻'),
  );
  root.append(actions);
  const draw = randomPanel(app);
  if (draw) root.append(draw);

  const index = state.index || { days: {} };
  const t = totals(index);
  // Las random bets aparecen cuando ya hay alguna guardada.
  const methods = METHODS.filter(([id]) => id !== RANDOM || t.methods[RANDOM]);
  root.append(
    h(
      'div',
      { class: 'grid2' },
      methods.map(([id, title]) => methodPanel(id, title, t.methods[id])),
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
        { class: `segmented${methods.length > 2 ? ' many' : ''}`, role: 'group', 'aria-label': 'Análisis a mostrar en cada día' },
        [['ambos', methods.length > 2 ? 'Todos' : 'Ambos'], ...methods.map(([id, , short]) => [id, short])].map(([id, name]) =>
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
            m.won + m.lost ? h('span', { class: m.won >= m.lost ? 'chip ok' : 'chip err', title: 'Acertadas de las resueltas' }, `${m.won}/${m.won + m.lost} aciertos`, hitPct(m)) : null,
            ...levelChips(m),
            m.pending ? h('span', { class: 'chip' }, `${m.pending} pendientes`) : null,
            m.staked ? money(m.profit) : null,
          ),
        ),
      ),
    );
    const box = h('div', { class: 'day' }, head);
    if (open) box.append(h('div', { class: 'day-body' }, dayTables(s, filter), state.dayCache.has(date) ? dayBody(state.dayCache.get(date), filter) : h('div', { class: 'note' }, 'Cargando…')));
    root.append(box);
  }
}
