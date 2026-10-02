// Historial de apuestas, liquidación con los resultados (Sofascore vía la
// extensión o los publicados por GitHub Actions) y entrenamiento de la red
// neuronal.
//
// Archivos (dentro de docs/ en GitHub o en el navegador):
//   data/historial/index.json         resumen por día
//   data/historial/AAAA-MM-DD.json    análisis del día con sus picks y combinadas
//   data/entrenamiento/AAAA-MM.json   selecciones analizadas + resultado real (para la red)
//   data/modelo/red-neuronal.json     pesos de la red neuronal
import * as ext from './ext.js';
import * as provider from './provider.js';
import * as store from './storage.js';
import { addDays, groupBy, limaDateOf, limaToday } from './util.js';
import { FEATURE_VERSION, FEATURES } from './analysis/features.js';
import { settle } from './analysis/markets.js';
import { Corrector } from './analysis/neural.js';
import { LEVELS } from './analysis/picks.js';

export const INDEX = 'data/historial/index.json';
export const MODEL = 'data/modelo/red-neuronal.json';
export const dayPath = (date) => `data/historial/${date}.json`;
export const rowsPath = (month) => `data/entrenamiento/${month}.json`;

const METHOD_NAME = { estadistico: 'estadístico', red_neuronal: 'red neuronal' };
const GRACE_MS = 2.5 * 3600000; // se consulta el resultado 2,5 h después del inicio
const CANCEL_FINAL_MS = 48 * 3600000; // aplazado/cancelado: nula tras 48 h

// ---- Guardar un análisis ----

function storedLeg(c, events) {
  return {
    key: c.key,
    eventId: c.eventId,
    sport: c.sport,
    start: c.start,
    match: events[c.eventId] ? `${events[c.eventId].home} vs ${events[c.eventId].away}` : '',
    url: events[c.eventId]?.url || null,
    market: c.market,
    sel: c.sel,
    line: c.line,
    label: c.label,
    status: 'pending',
  };
}

export function compactAnalysis(result) {
  const byKey = new Map(result.candidates.map((c) => [`${c.eventId}|${c.key}`, c]));
  return {
    id: result.id,
    method: result.method,
    created: result.created,
    date: result.date,
    settings: result.settings,
    network: result.network,
    sources: result.sources,
    events: result.events,
    picks: result.picks.map((c) => ({
      ...storedLeg(c, result.events),
      level: c.level,
      p: c.p,
      pBase: c.pBase,
      odds: c.best.price,
      source: c.best.source,
      reference: Boolean(c.best.reference),
      prices: c.prices,
      factors: c.factors,
      score: null,
    })),
    combos: result.combos.map((k) => ({
      id: k.id,
      source: k.source,
      target: k.target,
      odds: k.odds,
      p: k.p,
      status: 'pending',
      legs: k.legs.map((leg) => ({ ...storedLeg(byKey.get(`${leg.eventId}|${leg.key}`), result.events), price: leg.price, p: leg.p })),
    })),
  };
}

export function trainingRows(result) {
  return result.candidates.map((c) => ({
    key: `${c.eventId}|${c.key}`,
    date: result.date,
    eventId: c.eventId,
    url: result.events[c.eventId]?.url || null,
    sport: c.sport,
    start: c.start,
    market: c.market,
    sel: c.sel,
    line: c.line,
    x: c.x,
    pBase: Math.round(c.pBase * 1e4) / 1e4,
    odds: c.best.price,
    fv: FEATURE_VERSION,
    y: null,
  }));
}

function mergeRows(oldRows = [], newRows = []) {
  const map = new Map(oldRows.map((r) => [r.key, r]));
  for (const r of newRows) {
    const old = map.get(r.key);
    map.set(r.key, old && old.y != null ? { ...r, y: old.y } : r);
  }
  return [...map.values()];
}

export async function saveAnalysis(result) {
  const stored = compactAnalysis(result);
  const day = (await store.read(dayPath(result.date))) || { date: result.date, analyses: [] };
  day.analyses = day.analyses.filter((a) => a.id !== stored.id).concat(stored);
  await store.write(dayPath(result.date), day, `Historial: análisis ${METHOD_NAME[result.method]} del ${result.date}`);

  for (const [month, rows] of groupBy(trainingRows(result), (r) => r.date.slice(0, 7))) {
    const file = (await store.read(rowsPath(month))) || { rows: [] };
    file.rows = mergeRows(file.rows, rows);
    await store.write(rowsPath(month), file, `Entrenamiento: selecciones del ${result.date}`);
  }
  await refreshIndex([day]);
  return day;
}

// ---- Resúmenes ----

const emptyStats = () => ({ n: 0, won: 0, lost: 0, void: 0, pending: 0, profit: 0, staked: 0 });

function addResult(stats, status, odds) {
  stats.n++;
  if (status === 'won') {
    stats.won++;
    stats.profit += odds - 1;
    stats.staked++;
  } else if (status === 'lost') {
    stats.lost++;
    stats.profit -= 1;
    stats.staked++;
  } else if (status === 'void') stats.void++;
  else stats.pending++;
}

export function daySummary(day) {
  const out = { ...emptyStats(), byLevel: {}, byMethod: {}, combos: emptyStats() };
  for (const a of day.analyses || []) {
    out.byMethod[a.method] ||= emptyStats();
    for (const p of a.picks) {
      addResult(out, p.status, p.odds);
      addResult((out.byLevel[p.level] ||= emptyStats()), p.status, p.odds);
      addResult(out.byMethod[a.method], p.status, p.odds);
    }
    for (const k of a.combos || []) addResult(out.combos, k.status, k.odds);
  }
  out.pendingAll = out.pending + out.combos.pending;
  return out;
}

export async function loadIndex() {
  return (await store.read(INDEX)) || { days: {}, updated: null };
}

async function refreshIndex(days) {
  const index = await loadIndex();
  for (const day of days) index.days[day.date] = daySummary(day);
  index.updated = new Date().toISOString();
  await store.write(INDEX, index, 'Historial: actualizar resumen');
  return index;
}

// Totales de todos los días: por nivel, por método y combinadas.
export function totals(index) {
  const out = { all: emptyStats(), byLevel: {}, byMethod: {}, combos: emptyStats() };
  const add = (a, b) => {
    for (const k of Object.keys(emptyStats())) a[k] += b[k] || 0;
  };
  for (const s of Object.values(index.days || {})) {
    add(out.all, s);
    add(out.combos, s.combos || {});
    for (const [k, v] of Object.entries(s.byLevel || {})) add((out.byLevel[k] ||= emptyStats()), v);
    for (const [k, v] of Object.entries(s.byMethod || {})) add((out.byMethod[k] ||= emptyStats()), v);
  }
  return out;
}

export const hitRate = (s) => (s.won + s.lost ? s.won / (s.won + s.lost) : null);
export const roi = (s) => (s.staked ? s.profit / s.staked : null);
export { LEVELS };

// ---- Actualizar resultados ----

function resolveLeg(leg, results, now) {
  if (leg.status !== 'pending') return false;
  const res = results[leg.eventId];
  if (!res) return false;
  const status = settle(leg, { ...res, final: now - leg.start > CANCEL_FINAL_MS }, leg.sport);
  if (!status) return false;
  leg.status = status;
  leg.score = res.score;
  return true;
}

function comboStatus(combo) {
  const st = combo.legs.map((l) => l.status);
  if (st.includes('lost')) return 'lost';
  if (st.includes('pending')) return 'pending';
  return st.includes('won') ? 'won' : 'void';
}

// Odds de la combinada sin las selecciones anuladas.
function comboOdds(combo) {
  return combo.legs.filter((l) => l.status !== 'void').reduce((x, l) => x * l.price, 1);
}

const monthsBack = (n) => {
  const out = [];
  let d = limaToday();
  for (let i = 0; i < n; i++) {
    out.push(d.slice(0, 7));
    d = addDays(`${d.slice(0, 7)}-01`, -1);
  }
  return out;
};

export async function updateResults({ onProgress = () => {} } = {}) {
  const now = Date.now();
  const today = limaToday();
  const index = await loadIndex();
  let skipped = 0; // partidos de Sofascore sin la extensión
  const due = (x) => x.status === 'pending' && x.start < now - GRACE_MS;

  onProgress('Buscando apuestas pendientes', 0.05);
  const dayFiles = [];
  const ids = new Set();
  const urls = {}; // para leer la página del partido si el API de Sofascore no responde
  const note = (x) => x.url && (urls[x.eventId] = x.url);
  for (const date of Object.keys(index.days).filter((d) => d <= today && index.days[d].pendingAll > 0)) {
    const day = await store.read(dayPath(date));
    if (!day) continue;
    dayFiles.push(day);
    for (const a of day.analyses) {
      for (const leg of [...a.picks, ...(a.combos || []).flatMap((k) => k.legs)]) {
        if (!due(leg)) continue;
        ids.add(leg.eventId);
        note(leg);
      }
    }
  }
  const rowFiles = [];
  for (const month of monthsBack(2)) {
    const file = await store.read(rowsPath(month));
    if (!file) continue;
    rowFiles.push({ month, file });
    for (const r of file.rows) {
      if (r.y != null || r.start >= now - GRACE_MS) continue;
      ids.add(r.eventId);
      note(r);
    }
  }

  const results = {};
  const list = [...ids];
  // Partidos automáticos (Flashscore): resultados publicados cada 2 horas.
  const auto = list.filter(provider.isAuto);
  const starts = new Map();
  for (const day of dayFiles) for (const a of day.analyses) for (const leg of [...a.picks, ...(a.combos || []).flatMap((k) => k.legs)]) starts.set(leg.eventId, leg.start);
  for (const { file } of rowFiles) for (const r of file.rows) starts.set(r.eventId, r.start);
  const dates = new Set(auto.filter((id) => Number.isFinite(starts.get(id))).flatMap((id) => [limaDateOf(starts.get(id)), limaDateOf(starts.get(id) + 86400000)]));
  if (auto.length) onProgress('Resultados publicados', 0.1);
  for (const date of dates) {
    const published = await provider.loadResults(date, { force: true });
    for (const id of auto) if (published[id] && results[id]?.state !== 'finalizado') results[id] = published[id];
  }
  // Partidos de Sofascore: con la extensión.
  const sofa = list.filter((id) => !provider.isAuto(id));
  if (sofa.length && !ext.available()) skipped = sofa.length;
  for (let i = 0; ext.available() && i < sofa.length; i += 10) {
    onProgress(`Sofascore: resultados ${Math.min(i + 10, sofa.length)} de ${sofa.length}`, 0.1 + (0.6 * i) / Math.max(1, sofa.length));
    const chunk = sofa.slice(i, i + 10);
    const r = await ext.call('sofascore', 'getEventResults', { ids: chunk, urls: Object.fromEntries(chunk.map((id) => [id, urls[id]])) }, { timeout: 300000 });
    Object.assign(results, r.items);
  }

  onProgress('Liquidando apuestas', 0.75);
  let resolved = 0;
  const changedDays = [];
  for (const day of dayFiles) {
    let changed = false;
    for (const a of day.analyses) {
      for (const p of a.picks) if (resolveLeg(p, results, now)) (resolved++, (changed = true));
      for (const k of a.combos || []) {
        for (const l of k.legs) if (resolveLeg(l, results, now)) changed = true;
        const st = comboStatus(k);
        if (st !== k.status) {
          k.status = st;
          k.odds = st === 'pending' ? k.odds : comboOdds(k);
          changed = true;
        }
      }
    }
    if (changed) {
      await store.write(dayPath(day.date), day, `Historial: resultados del ${day.date}`);
      changedDays.push(day);
    }
  }
  let newRows = 0;
  for (const { month, file } of rowFiles) {
    let changed = false;
    for (const r of file.rows) {
      if (r.y != null) continue;
      const res = results[r.eventId];
      if (!res) continue;
      const status = settle(r, { ...res, final: now - r.start > CANCEL_FINAL_MS }, r.sport);
      if (!status) continue;
      r.y = status === 'won' ? 1 : status === 'lost' ? 0 : -1;
      changed = true;
      newRows++;
    }
    if (changed) await store.write(rowsPath(month), file, `Entrenamiento: resultados de ${month}`);
  }
  if (changedDays.length) await refreshIndex(changedDays);

  let network = null;
  if (newRows) {
    onProgress('Reentrenando la red neuronal', 0.85);
    network = await trainNetwork();
  }
  onProgress('Listo', 1);
  return { checked: list.length, resolved, newRows, skipped, network: network?.meta || null };
}

// ---- Red neuronal ----

export async function loadNetwork() {
  const saved = await store.read(MODEL).catch(() => null);
  return saved ? Corrector.fromJSON(saved) : new Corrector({ inputs: FEATURES.length });
}

export async function trainNetwork() {
  const rows = [];
  for (const month of monthsBack(6)) {
    const file = await store.read(rowsPath(month));
    for (const r of file?.rows || []) if (r.fv === FEATURE_VERSION && (r.y === 0 || r.y === 1)) rows.push(r);
  }
  const net = new Corrector({ inputs: FEATURES.length });
  net.train(rows.map((r) => ({ x: r.x, pBase: r.pBase, y: r.y, start: r.start })));
  await store.write(MODEL, net.toJSON(), `Red neuronal: reentrenada con ${net.meta.samples} resultados`);
  return net;
}

// ---- Subir lo guardado en el navegador a GitHub ----

export async function uploadLocalToGithub({ onProgress = () => {} } = {}) {
  if (!store.isGithub()) throw new Error('Configura primero el token de GitHub (⚙ Ajustes)');
  const paths = (await store.localPaths()).filter((p) => p.startsWith('data/historial/2') || p.startsWith('data/entrenamiento/'));
  const days = [];
  for (const [i, path] of paths.entries()) {
    onProgress(`Subiendo ${path}`, i / Math.max(1, paths.length));
    const local = await store.readLocal(path);
    const remote = await store.read(path);
    if (path.startsWith('data/historial/')) {
      const merged = remote || { date: local.date, analyses: [] };
      const ids = new Set(merged.analyses.map((a) => a.id));
      merged.analyses.push(...local.analyses.filter((a) => !ids.has(a.id)));
      await store.write(path, merged, `Historial: subir datos locales del ${local.date}`);
      days.push(merged);
    } else {
      const merged = { rows: mergeRows(remote?.rows || [], local.rows || []) };
      await store.write(path, merged, 'Entrenamiento: subir datos locales');
    }
  }
  if (days.length) await refreshIndex(days);
  return { files: paths.length };
}

export { METHOD_NAME };
