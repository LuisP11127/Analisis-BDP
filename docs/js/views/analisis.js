// Pestaña "Análisis": picks por nivel de confianza y combinadas.
import { MIN_SAMPLES } from '../analysis/neural.js';
import { BOOKMAKERS, LEVELS } from '../analysis/picks.js';
import { sportOf } from '../sports.js';
import { fmtDateTime, fmtTime, h, pct } from '../util.js';

const SOURCE_NAMES = { sofascore: 'Sofascore', apuestatotal: 'Apuesta Total', betano: 'Betano', understat: 'Understat' };
const MODE = { 'direct-api': 'directo', direct: 'directo', tab: 'pestaña', navigate: 'navegando' };
const PRICE_SHORT = { apuestatotal: 'AT', betano: 'Betano', sofascore: 'Sofascore' };

export const methodTitle = (m) => (m === 'red_neuronal' ? 'Análisis con red neuronal' : 'Análisis estadístico');

function sourceChip(id, s) {
  if (!s) return null;
  if (!s.ok) return h('span', { class: 'chip err', title: s.error || '' }, `${SOURCE_NAMES[id]}: error`);
  const extra = s.matched != null ? ` · ${s.matched} partidos` : s.mode ? ` · ${MODE[s.mode] || s.mode}` : '';
  return h('span', { class: 'chip ok' }, `${SOURCE_NAMES[id]}${extra}`);
}

function pickCard(p, ev) {
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

export function renderAnalisis(root, app) {
  const a = app.state.analysis;
  root.replaceChildren();
  if (!a) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        'Marca partidos o ligas en la pestaña Partidos y pulsa ',
        h('b', {}, 'Análisis estadístico'),
        ' o ',
        h('b', {}, 'Análisis red neuronal'),
        '.',
      ),
    );
    return;
  }
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
    h('div', { class: 'row' }, ['sofascore', 'apuestatotal', 'betano', 'understat'].map((id) => sourceChip(id, a.sources[id]))),
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
      app.state.analysisSaved
        ? h('span', { class: 'chip ok' }, 'Guardado en el historial')
        : app.canSave()
          ? h('button', { class: 'btn small', onclick: () => app.saveCurrentAnalysis() }, 'Guardar en historial')
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
      picks.length ? h('div', { class: 'cards' }, picks.map((p) => pickCard(p, a.events[p.eventId]))) : h('div', { class: 'note' }, 'Sin picks en este nivel.'),
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
