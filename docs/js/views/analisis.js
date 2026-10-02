// Pestaña "Análisis": el último análisis estadístico y el último con red
// neuronal, comparados y cada uno con sus picks por nivel y combinadas.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { BOOKMAKERS, LEVELS } from '../analysis/picks.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtTime, h, pct } from '../util.js';

const SOURCE_NAMES = { sofascore: 'Sofascore', flashscore: 'Flashscore', apuestatotal: 'Apuesta Total', betano: 'Betano', understat: 'Understat' };
const MODE = { 'direct-api': 'directo', direct: 'directo', tab: 'pestaña', navigate: 'navegando' };
const PRICE_SHORT = { apuestatotal: 'AT', betano: 'Betano', sofascore: 'Sofascore' };

export const methodTitle = (m) => (m === 'red_neuronal' ? 'Análisis con red neuronal' : 'Análisis estadístico');
const METHODS = [
  ['estadistico', 'Estadístico'],
  ['red_neuronal', 'Red neuronal'],
];

function sourceChip(id, s) {
  if (!s) return null;
  if (!s.ok) return h('span', { class: 'chip err', title: s.error || '' }, `${SOURCE_NAMES[id]}: error`);
  const extra = s.matched != null ? ` · ${s.matched} partidos` : s.mode ? ` · ${MODE[s.mode] || s.mode}` : '';
  const title = s.published ? 'Cuotas publicadas por GitHub Actions (cada 2 horas)' : s.generated ? `Datos publicados el ${fmtDateTime(Date.parse(s.generated))}` : '';
  return h('span', { class: 'chip ok', title }, `${SOURCE_NAMES[id]}${extra}${s.published ? ' (publicadas)' : ''}`);
}

function pickCard(p, ev, method) {
  const sport = sportOf(p.sport);
  const others = Object.entries(p.prices || {})
    .filter(([src]) => src !== p.best.source)
    .map(([src, price]) => `${PRICE_SHORT[src] || src} ${price.toFixed(2)}`);
  return h(
    'div',
    { class: `card ${p.level}` },
    h('div', { class: 'meta' }, `${sport.icon} ${ev?.league || ''} · ${fmtTime(p.start)}`),
    h('div', {}, ev ? `${ev.home} vs ${ev.away}` : ''),
    h('div', { class: 'pick' }, p.label),
    h(
      'div',
      { class: 'nums' },
      h('span', { class: 'odds' }, p.best.price.toFixed(2)),
      h('span', { class: 'meta' }, BOOKMAKERS[p.best.source]),
      h('span', { class: 'prob' }, `Prob. ${pct(p.p)}`),
      p.ev > 0.01 ? h('span', { class: 'value' }, `+${Math.round(p.ev * 100)}% de valor`) : null,
    ),
    h('div', { class: 'meter' }, h('span', { style: `width:${Math.round(p.p * 100)}%` })),
    method === 'red_neuronal' && Math.abs(p.p - p.pBase) >= 0.005
      ? h('div', { class: 'meta' }, `Estadístico ${pct(p.pBase)} → red neuronal ${pct(p.p)}`)
      : null,
    others.length ? h('div', { class: 'meta' }, `Otras cuotas: ${others.join(' · ')}`) : null,
    p.factors?.length ? h('ul', {}, p.factors.map((f) => h('li', {}, f))) : null,
  );
}

function comboCard(k, analysis) {
  const byKey = new Map(analysis.candidates.map((c) => [`${c.eventId}|${c.key}`, c]));
  return h(
    'div',
    { class: 'card combo' },
    h('div', { class: 'meta' }, `${BOOKMAKERS[k.source]} · objetivo cuota ${k.target}+`),
    h(
      'div',
      { class: 'nums' },
      h('span', { class: 'odds' }, k.odds.toFixed(2)),
      h('span', { class: 'prob' }, `Prob. estimada ${pct(k.p)}`),
      h('span', { class: 'meta' }, `${k.legs.length} selecciones`),
    ),
    h('div', { class: 'meter' }, h('span', { style: `width:${Math.round(k.p * 100)}%` })),
    h(
      'ol',
      {},
      k.legs.map((leg) => {
        const c = byKey.get(`${leg.eventId}|${leg.key}`);
        const ev = analysis.events[leg.eventId];
        return h('li', {}, `${ev ? `${ev.home} vs ${ev.away}` : ''}: `, h('b', {}, c?.label || leg.key), ` @ ${leg.price.toFixed(2)} (${pct(leg.p)})`);
      }),
    ),
  );
}

// Texto para copiar y compartir (WhatsApp, notas...).
export function analysisText(a) {
  const lines = [`${methodTitle(a.method)} · ${a.date}`];
  for (const level of LEVELS) {
    const picks = a.picks.filter((p) => p.level === level.id);
    if (!picks.length) continue;
    lines.push('', `Confianza ${level.name.toLowerCase()}`);
    for (const p of picks) {
      const ev = a.events[p.eventId];
      lines.push(`• ${ev.home} vs ${ev.away} (${fmtTime(p.start)}): ${p.label} @ ${p.best.price.toFixed(2)} ${BOOKMAKERS[p.best.source]} · ${pct(p.p)}`);
    }
  }
  if (a.combos.length) {
    lines.push('', 'Combinadas');
    const byKey = new Map(a.candidates.map((c) => [`${c.eventId}|${c.key}`, c]));
    for (const k of a.combos) {
      lines.push(`${BOOKMAKERS[k.source]} · cuota ${k.odds.toFixed(2)} · prob. ${pct(k.p)}`);
      for (const leg of k.legs) {
        const ev = a.events[leg.eventId];
        lines.push(`   - ${ev.home} vs ${ev.away}: ${byKey.get(`${leg.eventId}|${leg.key}`)?.label} @ ${leg.price.toFixed(2)}`);
      }
    }
  }
  return lines.join('\n');
}

// Cuántos picks de cada nivel y combinadas dio cada método, y cuántos coinciden.
function comparison(app) {
  const { estadistico: est, red_neuronal: rn } = app.state.analyses;
  if (!est || !rn) return null;
  const count = (a, level) => a.picks.filter((p) => p.level === level).length;
  const keys = (a) => new Set(a.picks.map((p) => `${p.eventId}|${p.key}`));
  const ke = keys(est);
  const kr = keys(rn);
  const both = [...ke].filter((k) => kr.has(k)).length;
  const row = (name, a, b) => h('tr', {}, h('td', {}, name), h('td', { class: 'num' }, a), h('td', { class: 'num' }, b));
  const sameRun = est.run && est.run === rn.run;
  const net = rn.network;
  return h(
    'div',
    { class: 'panel compare' },
    h('h3', {}, 'Comparación'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Estadístico'), h('th', { class: 'num' }, 'Red neuronal'))),
        h(
          'tbody',
          {},
          LEVELS.map((l) => row(l.name, count(est, l.id), count(rn, l.id))),
          row('Combinadas', est.combos.length, rn.combos.length),
          row('Partidos', Object.keys(est.events).length, Object.keys(rn.events).length),
        ),
      ),
    ),
    h(
      'p',
      { class: 'note' },
      sameRun
        ? `Mismos partidos (${fmtDateTime(Date.parse(est.created))}). Coinciden ${both} picks; ${ke.size - both} solo en el estadístico y ${kr.size - both} solo en la red neuronal.`
        : `Hechos por separado: estadístico ${fmtDateTime(Date.parse(est.created))}, red neuronal ${fmtDateTime(Date.parse(rn.created))}.`,
      net && !net.trained ? ` La red neuronal todavía no corrige (${net.samples || 0} de ${MIN_SAMPLES} resultados): por ahora sus probabilidades son las del estadístico.` : '',
    ),
  );
}

function methodSwitch(app) {
  const { analyses, analysisView } = app.state;
  return h(
    'div',
    { class: 'segmented wide', role: 'group', 'aria-label': 'Análisis a mostrar' },
    METHODS.map(([id, name]) =>
      h(
        'button',
        { class: id === analysisView ? 'active' : '', title: analyses[id] ? `${analyses[id].picks.length} picks` : 'Sin hacer', onclick: () => app.setAnalysisView(id) },
        name,
        h('span', { class: 'n' }, analyses[id] ? ` ${analyses[id].picks.length}` : ' –'),
      ),
    ),
  );
}

export function renderAnalisis(root, app) {
  const { analyses, analysisView } = app.state;
  root.replaceChildren();
  if (!analyses.estadistico && !analyses.red_neuronal) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        'Marca partidos o ligas en la pestaña Partidos y pulsa ',
        h('b', {}, 'Análisis estadístico'),
        ', ',
        h('b', {}, 'Análisis red neuronal'),
        ' o ',
        h('b', {}, 'Ambos análisis'),
        '. Cada uno se guarda por separado en el historial.',
      ),
    );
    return;
  }
  root.append(...[comparison(app), methodSwitch(app)].filter(Boolean));
  const a = analyses[analysisView];
  if (!a) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        `Todavía no hiciste el ${methodTitle(analysisView).toLowerCase()} con estos partidos. Pulsa `,
        h('b', {}, analysisView === 'red_neuronal' ? 'Análisis red neuronal' : 'Análisis estadístico'),
        ' o ',
        h('b', {}, 'Ambos análisis'),
        '.',
      ),
    );
    return;
  }
  renderMethod(root, app, a);
}

function renderMethod(root, app, a) {
  const analyzed = Object.keys(a.events).length;
  const net = a.network;
  const summary = h(
    'div',
    { class: 'summary' },
    h('h2', {}, methodTitle(a.method)),
    h(
      'div',
      { class: 'row note' },
      `${analyzed} partidos analizados · ${a.picks.length} picks · ${a.combos.length} combinadas · ${fmtDateTime(Date.parse(a.created))}`,
      a.skipped ? ` · ${a.skipped} omitidos (ya empezaron)` : '',
    ),
    h('div', { class: 'row' }, ['sofascore', 'flashscore', 'apuestatotal', 'betano', 'understat'].map((id) => sourceChip(id, a.sources[id]))),
    a.method === 'red_neuronal'
      ? h(
          'div',
          { class: `banner${net?.trained ? '' : ' warn'}` },
          net?.trained
            ? `Red neuronal entrenada con ${net.samples} resultados: corrige las probabilidades del análisis estadístico.`
            : (net?.samples || 0) < MIN_SAMPLES
              ? `La red neuronal aún no tiene suficientes resultados para corregir (${net?.samples || 0} de ${MIN_SAMPLES}). Por ahora da lo mismo que el análisis estadístico; aprende cada vez que actualizas resultados en Historial.`
              : `Con ${net.samples} resultados la red todavía no mejora al análisis estadístico, así que no corrige nada. Sigue aprendiendo con cada actualización de resultados.`,
        )
      : null,
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn small', onclick: () => app.copyAnalysis() }, 'Copiar picks'),
      a.saved
        ? h('span', { class: 'chip ok' }, 'Guardado en el historial')
        : app.canSave() && a.candidates.length
          ? h('button', { class: 'btn small', onclick: () => app.saveAnalyses([a]) }, 'Guardar en historial')
          : h('span', { class: 'chip warn' }, 'Sin guardar'),
    ),
  );
  root.append(summary);

  if (!a.picks.length && !a.combos.length) {
    root.append(
      h(
        'div',
        { class: 'banner' },
        'No hubo selecciones con suficiente probabilidad y cuota. Prueba con más partidos o revisa en Ajustes los mínimos de probabilidad y cuota.',
      ),
    );
  }
  const colors = { alta: 'var(--alta)', moderada_alta: 'var(--modalta)', moderada: 'var(--mod)' };
  const s = a.settings;
  const ranges = { alta: `≥ ${pct(s.alta)}`, moderada_alta: `${pct(s.moderadaAlta)}–${pct(s.alta)}`, moderada: `${pct(s.moderada)}–${pct(s.moderadaAlta)}` };
  for (const level of LEVELS) {
    const picks = a.picks.filter((p) => p.level === level.id);
    root.append(
      h(
        'div',
        { class: 'level' },
        h('span', { class: 'bar', style: `background:${colors[level.id]}` }),
        h('h3', {}, `Confianza ${level.name.toLowerCase()}`),
        h('span', { class: 'note' }, `${ranges[level.id]} · ${picks.length}`),
      ),
    );
    root.append(
      picks.length ? h('div', { class: 'cards' }, picks.map((p) => pickCard(p, a.events[p.eventId], a.method))) : h('div', { class: 'note' }, 'Sin picks en este nivel.'),
    );
  }
  root.append(
    h(
      'div',
      { class: 'level' },
      h('span', { class: 'bar', style: 'background:var(--nn)' }),
      h('h3', {}, 'Combinadas'),
      h('span', { class: 'note' }, `cuota ${s.comboTargets.join(' y ')} o más`),
    ),
  );
  root.append(
    a.combos.length
      ? h('div', { class: 'cards' }, a.combos.map((k) => comboCard(k, a)))
      : h('div', { class: 'note' }, 'No se pudo armar una combinada: hacen falta más selecciones con cuota en la misma casa.'),
  );
  root.append(
    h(
      'p',
      { class: 'note' },
      'Las probabilidades son estimaciones de los modelos, no garantías. Una combinada de cuota 5 tiene, según el propio mercado, alrededor de 20% de probabilidad: la página busca la combinación con la mayor probabilidad estimada para esa cuota. Apuesta solo lo que estés dispuesto a perder.',
    ),
  );
}
