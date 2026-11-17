// Pestaña "Selector": los picks del último análisis que caen en un mercado (o
// lado) de una liga con 67% o más de acierto, o la inversa si tiene 33% o
// menos; y el seguimiento por día de sus dos secciones.
import { BOOKMAKERS } from '../analysis/picks.js';
import { RULES, SEL_GENERAL, SEL_LADO, SIDE_NAME, qualifying } from '../selector.js';
import { totals } from '../history.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtDay, fmtTime, h, limaDateOf, limaToday } from '../util.js';
import { SPORT_FROM, foldGroup, hitPct, leagueName, legLine, marketName, money, statsRow, statsTable } from './historial.js';

export const SECTIONS = [
  [SEL_GENERAL, 'General', 'Tipo de mercado de cada liga'],
  [SEL_LADO, 'Por lado', 'Cada lado del mercado de cada liga (más/menos, local/visitante…)'],
];
const SRC = { estadistico: 'Est', red_neuronal: 'Red Neu' };
const ZERO = { won: 0, lost: 0, pending: 0, staked: 0, profit: 0, void: 0, n: 0 };

const whenOf = (ms) => (limaDateOf(ms) === limaToday() ? fmtTime(ms) : fmtDateTime(ms));
const odds = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const srcTag = (methods) =>
  h('span', { class: `src-tag${methods.length > 1 ? ' both' : ''}`, title: 'Análisis que dieron el pick' }, ['estadistico', 'red_neuronal'].filter((m) => methods.includes(m)).map((m) => SRC[m]).join(' + '));
const invTag = () => h('span', { class: 'inv-tag', title: 'El mercado acierta 33% o menos en esta liga: se apuesta lo contrario' }, 'Elegir inversa');
// "Est: Hándicap 27% de 15" o, por lado, "Est: Hándicap · Local 27% de 15".
// Nombre corto del mercado: "Resultado" en vez de "Resultado (1X2, doble oportunidad, ganador)".
const shortMarket = (k) => marketName(k).replace(/ \(.*\)$/, '');
const whyText = (p, section) =>
  p.rules.map((r) => `${SRC[r.method]}: ${shortMarket(p.family)}${section === SEL_LADO ? ` · ${SIDE_NAME[p.side] || p.side}` : ''} ${r.hit}% de ${r.n}`).join(' · ');

// Una apuesta del selector: el pick original y, si es inversa, lo que se apuesta.
function betBits(p, section) {
  return [
    srcTag(p.methods),
    p.inverse ? invTag() : null,
    h('b', {}, p.inverse ? p.orig.label : p.label),
    h('span', { class: 'note' }, `@ ${odds(p.inverse ? p.orig.odds : p.odds)}`),
    p.inverse
      ? h('span', {}, '→ ', h('b', {}, p.label), h('span', { class: 'note' }, Number.isFinite(p.odds) ? ` @ ${odds(p.odds)} ${BOOKMAKERS[p.source] || ''}` : ' · sin cuota en el análisis'))
      : null,
    h('span', { class: 'why' }, whyText(p, section)),
  ];
}

// Apuestas agrupadas por deporte y liga.
function byLeague(picks) {
  const groups = new Map();
  for (const p of picks) {
    const k = `${p.sport}#${p.league}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups.values()].sort((a, b) => sportOf(a[0].sport).name.localeCompare(sportOf(b[0].sport).name) || leagueName(a[0].league).localeCompare(leagueName(b[0].league)));
}

function currentSection(sel, section, title, note) {
  const picks = sel[section];
  const inv = picks.filter((p) => p.inverse).length;
  return h(
    'div',
    { class: 'panel' },
    h('h3', {}, `${title}: ${picks.length} ${picks.length === 1 ? 'apuesta' : 'apuestas'}`, inv ? h('span', { class: 'note' }, ` (${inv} ${inv === 1 ? 'inversa' : 'inversas'})`) : null),
    h('p', { class: 'note' }, note),
    picks.length
      ? byLeague(picks).map((ys) =>
          h(
            'div',
            { class: 'league-group' },
            h('div', { class: 'league-sub' }, `${sportOf(ys[0].sport).icon} ${leagueName(ys[0].league)}`),
            h(
              'ul',
              { class: 'leg-list' },
              ys.map((p) => h('li', { class: 'sel-item' }, h('span', {}, `${p.match} (${whenOf(p.start)}):`), ...betBits(p, section))),
            ),
          ),
        )
      : h('div', { class: 'note' }, 'Ningún pick de este análisis cae en un mercado que cumpla la regla.'),
  );
}

// Mercados y lados que hoy cumplen la regla (plegable).
function rulesFold(app, t) {
  const list = qualifying(t.methods);
  const items = list
    .sort((a, b) => a.section.localeCompare(b.section) || a.method.localeCompare(b.method) || a.sport.localeCompare(b.sport) || leagueName(a.league).localeCompare(leagueName(b.league)))
    .map((q) =>
      h(
        'li',
        {},
        h('span', { class: 'src-tag' }, SRC[q.method]),
        q.rule === 'inversa' ? invTag() : h('span', { class: 'chip ok' }, 'Directa'),
        h('span', {}, `${sportOf(q.sport).icon} ${leagueName(q.league)} · ${shortMarket(q.family)}${q.side ? ` · ${SIDE_NAME[q.side] || q.side}` : ''}: ${q.hit}% de ${q.n}`),
      ),
    );
  const body = SECTIONS.map(([id, title]) => {
    const xs = items.filter((_, i) => list[i].section === id);
    return h('div', { class: 'league-group' }, h('div', { class: 'league-sub' }, `${title} · ${xs.length}`), xs.length ? h('ul', { class: 'leg-list sel-rules' }, xs) : h('div', { class: 'note' }, 'Ninguno por ahora.'));
  });
  const key = 'selector|reglas';
  const box = h(
    'details',
    { class: 'fold', open: app.state.openGroups.has(key) },
    h('summary', {}, h('span', { class: 'fold-title' }, h('span', { class: 'lvl' }, 'Mercados que cumplen la regla hoy')), h('span', { class: 'chip' }, `${list.length}`)),
    body,
  );
  box.addEventListener('toggle', () => (box.open ? app.state.openGroups.add(key) : app.state.openGroups.delete(key)));
  return box;
}

function currentPanel(app, t) {
  const sel = app.state.selector;
  const rules = `Desde el ${fmtDay(SPORT_FROM).split(', ').pop()}, con las cifras de "Por deporte" de cada análisis: mínimo ${RULES.minResolved} apuestas resueltas; ${RULES.direct}% o más se apuesta tal cual, ${RULES.inverse}% o menos se elige la inversa. Solo picks de los tres niveles, sin los de valor ni combinadas.`;
  const head = [h('h2', {}, 'Selector'), h('p', { class: 'note' }, rules), rulesFold(app, t)];
  if (!sel)
    return h(
      'div',
      { class: 'summary' },
      ...head,
      h('div', { class: 'empty' }, 'Haz un análisis (estadístico, red neuronal o ambos) y aquí aparecen sus picks que cumplen la regla.'),
    );
  const total = sel[SEL_GENERAL].length + sel[SEL_LADO].length;
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'summary' },
      ...head,
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'note' }, `Análisis ${sel.methods.map((m) => SRC[m]).join(' + ')} · ${fmtDateTime(Date.parse(sel.created))}`),
        total ? h('button', { class: 'btn small', onclick: () => app.copySelector() }, 'Copiar') : null,
        sel.saved ? h('span', { class: 'chip ok' }, 'Guardado en el historial') : total ? h('span', { class: 'chip warn' }, 'Sin guardar') : null,
      ),
    ),
    h('div', { class: 'sel-sections' }, SECTIONS.map(([id, title, note]) => currentSection(sel, id, title, note))),
  );
}

// Texto para copiar.
export function selectorText(sel) {
  const lines = ['Selector'];
  for (const [id, title] of SECTIONS) {
    if (!sel[id].length) continue;
    lines.push('', `${title}:`);
    for (const p of sel[id]) {
      const src = ['estadistico', 'red_neuronal'].filter((m) => p.methods.includes(m)).map((m) => SRC[m]).join(' + ');
      lines.push(
        p.inverse
          ? `• ${p.match} (${whenOf(p.start)}): ${p.orig.label} @ ${odds(p.orig.odds)} → elegir inversa: ${p.label}${Number.isFinite(p.odds) ? ` @ ${odds(p.odds)}` : ''} [${src}]`
          : `• ${p.match} (${whenOf(p.start)}): ${p.label} @ ${odds(p.odds)} [${src}]`,
      );
    }
  }
  return lines.join('\n');
}

// ---- Seguimiento ----

function totalsPanel(id, title, m) {
  const k = m?.byKind || {};
  return h('div', { class: 'panel' }, h('h3', {}, `Selector ${title.toLowerCase()}`), statsTable([statsRow('Directas', k.directa || ZERO), statsRow('Inversas', k.inversa || ZERO), statsRow('Total', m || ZERO, 'total')]));
}

function dayBody(app, date, day) {
  if (!day) return h('div', { class: 'note' }, 'No se encontró el detalle de este día.');
  return SECTIONS.map(([id, title]) => {
    const picks = day.analyses.filter((a) => a.method === id).flatMap((a) => a.picks);
    if (!picks.length) return null;
    return h(
      'div',
      { class: 'analysis-block' },
      h('h4', {}, h('span', { class: `method-tag ${id}` }, title)),
      [
        ['directa', 'Directas', picks.filter((p) => !p.inverse)],
        ['inversa', 'Elegir inversa', picks.filter((p) => p.inverse)],
      ]
        .filter(([, , xs]) => xs.length)
        .map(([k, name, xs]) =>
          foldGroup(
            app,
            `${date}|${id}|${k}`,
            h('span', { class: 'lvl' }, name),
            xs,
            `lvl-${k}`,
            byLeague(xs).map((ys) =>
              h(
                'div',
                { class: 'league-group' },
                h('div', { class: 'league-sub' }, `${sportOf(ys[0].sport).icon} ${leagueName(ys[0].league)}`, h('span', { class: 'note' }, ` · ${ys.length}`)),
                h(
                  'ul',
                  { class: 'leg-list' },
                  ys.map((p) =>
                    legLine(p, [
                      srcTag(p.methods),
                      p.inverse ? h('span', { class: 'note' }, `(pick: ${p.orig.label})`) : null,
                      h('span', { class: 'note' }, `@ ${odds(p.odds)}`),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        ),
    );
  });
}

function historyList(app, index) {
  const dates = Object.keys(index.days || {})
    .filter((d) => SECTIONS.some(([id]) => index.days[d].methods?.[id]))
    .sort()
    .reverse();
  if (!dates.length) return [h('div', { class: 'empty' }, 'Todavía no hay apuestas del selector guardadas. Se guardan solas con cada análisis.')];
  return dates.map((date) => {
    const s = index.days[date];
    const open = app.state.openSelDays.has(date);
    const head = h(
      'button',
      { class: 'day-head', onclick: () => app.toggleSelDay(date) },
      h('span', { class: 'date' }, fmtDay(date)),
      h(
        'span',
        { class: 'day-lines' },
        SECTIONS.filter(([id]) => s.methods[id]).map(([id, title]) => {
          const m = s.methods[id];
          return h(
            'span',
            { class: 'day-line' },
            h('b', {}, title),
            h('span', { class: 'chip' }, `${m.n} apuestas`),
            m.won + m.lost ? h('span', { class: m.won >= m.lost ? 'chip ok' : 'chip err' }, `${m.won}/${m.won + m.lost} aciertos`, hitPct(m)) : null,
            m.pending ? h('span', { class: 'chip' }, `${m.pending} pendientes`) : null,
            m.staked ? money(m.profit) : null,
          );
        }),
      ),
    );
    const box = h('div', { class: 'day' }, head);
    if (open) box.append(h('div', { class: 'day-body' }, app.state.dayCache.has(date) ? dayBody(app, date, app.state.dayCache.get(date)) : h('div', { class: 'note' }, 'Cargando…')));
    return box;
  });
}

export function renderSelector(root, app) {
  const index = app.state.index || { days: {} };
  const recent = totals({ days: Object.fromEntries(Object.entries(index.days || {}).filter(([d]) => d >= SPORT_FROM)) });
  const all = totals(index);
  root.replaceChildren(
    currentPanel(app, recent),
    h(
      'div',
      { class: 'toolbar' },
      h('h3', {}, 'Seguimiento del selector'),
      h('button', { class: 'btn small', disabled: app.storage.mode === 'lectura', onclick: () => app.updateResults() }, 'Actualizar resultados'),
      h('button', { class: 'btn small ghost', onclick: () => app.reloadHistory() }, '↻'),
    ),
    h('div', { class: 'grid2' }, SECTIONS.map(([id, title]) => totalsPanel(id, title, all.methods[id]))),
    ...historyList(app, index),
  );
}
