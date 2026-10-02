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
import { parseMarketId } from './analysis/catalog.js';
import { profitOf } from './analysis/outcomes.js';
import { mergeRecords, recordFromSofascore } from './analysis/records.js';
import { Corrector } from './analysis/neural.js';
import { LEVELS } from './analysis/picks.js';

export const INDEX = 'data/historial/index.json';
export const MODEL = 'data/modelo/red-neuronal.json';
export const dayPath = (date) => `data/historial/${date}.json`;
export const rowsPath = (month) => `data/entrenamiento/${month}.json`;

const METHOD_NAME = { estadistico: 'estadístico', red_neuronal: 'red neuronal' };
const SUMMARY_VERSION = 2; // resúmenes por método (los anteriores se recalculan)
const GRACE_MS = 2.5 * 3600000; // se consulta el resultado 2,5 h después del inicio
const CANCEL_FINAL_MS = 48 * 3600000; // aplazado/cancelado: nula tras 48 h
const NO_DATA_MS = 96 * 3600000; // terminado sin los datos de esa apuesta (p. ej. córners): nula tras 4 días

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
    run: result.run || result.created,
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

// Filas para la red: por partido, las selecciones con probabilidad en la zona
// donde salen picks y combinadas (las de cuota muy alta no aportan), hasta 60.
const ROWS_PER_EVENT = 60;
function rowCandidates(candidates) {
  const out = [];
  for (const list of groupBy(candidates, (c) => c.eventId).values()) {
    const useful = list.filter((c) => c.pBase >= 0.4 && c.pBase <= 0.97);
    out.push(...(useful.length > ROWS_PER_EVENT ? useful.sort((a, b) => b.pBase - a.pBase).slice(0, ROWS_PER_EVENT) : useful));
  }
  return out;
}

export function trainingRows(result) {
  return rowCandidates(result.candidates).map((c) => ({
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

// Guarda uno o varios análisis del mismo día (p. ej. estadístico y red
// neuronal hechos juntos) con un solo cambio por archivo.
export async function saveAnalysis(input) {
  const results = (Array.isArray(input) ? input : [input]).filter(Boolean);
  if (!results.length) return null;
  const { date } = results[0];
  const stored = results.map(compactAnalysis);
  const ids = new Set(stored.map((a) => a.id));
  const day = (await store.read(dayPath(date))) || { date, analyses: [] };
  day.analyses = day.analyses.filter((a) => !ids.has(a.id)).concat(stored);
  const names = results.map((r) => METHOD_NAME[r.method]).join(' y ');
  await store.write(dayPath(date), day, `Historial: análisis ${names} del ${date}`);

  for (const [month, rows] of groupBy(results.flatMap(trainingRows), (r) => r.date.slice(0, 7))) {
    const file = (await store.read(rowsPath(month))) || { rows: [] };
    file.rows = mergeRows(file.rows, rows);
    await store.write(rowsPath(month), file, `Entrenamiento: selecciones del ${date}`);
  }
  await refreshIndex([day]);
  return day;
}

// ---- Resúmenes ----

const emptyStats = () => ({ n: 0, won: 0, lost: 0, void: 0, pending: 0, profit: 0, staked: 0 });

// Medias apuestas (líneas asiáticas .25/.75): cuentan como acierto o fallo y
// la ganancia es la mitad.
function addResult(stats, status, odds) {
  stats.n++;
  if (status === 'won' || status === 'half_won') stats.won++;
  else if (status === 'lost' || status === 'half_lost') stats.lost++;
  else if (status === 'void') stats.void++;
  else {
    stats.pending++;
    return;
  }
  if (status !== 'void') {
    stats.profit += profitOf(status, odds);
    stats.staked++;
  }
}

// ¿La apuesta necesita más que el marcador final (periodos, estadísticas, minutos)?
export function needsRecord(market) {
  const spec = parseMarketId(market);
  if (!spec) return false;
  if (['AND', 'OR'].includes(spec.t)) return true;
  return spec.stat !== 'score' || !['ft', 'reg'].includes(spec.scope) || !['1X2', 'ML', 'DC', 'OU', 'BTTS', 'HCP', 'CS', 'MRG', 'OE', 'CNT'].includes(spec.t);
}

const comboKey = (k) => `${k.source}|${k.legs.map((l) => `${l.eventId}|${l.key}`).sort().join(',')}`;

// Picks y combinadas de cada método sin repetir: si el mismo pick sale en
// varios análisis del día, cuenta una sola vez (el del análisis más reciente).
export function latestByMethod(day) {
  const out = new Map(); // método -> { picks: Map, combos: Map }
  const list = (day.analyses || []).slice().sort((a, b) => String(a.created).localeCompare(String(b.created)));
  for (const a of list) {
    if (!out.has(a.method)) out.set(a.method, { picks: new Map(), combos: new Map() });
    const m = out.get(a.method);
    for (const p of a.picks) m.picks.set(`${p.eventId}|${p.key}`, p);
    for (const k of a.combos || []) m.combos.set(comboKey(k), k);
  }
  return out;
}

const methodStats = () => ({ ...emptyStats(), byLevel: {}, combos: emptyStats() });

// Resumen de un día: por método (methods) y la suma de ambos.
export function daySummary(day) {
  const out = { ...emptyStats(), v: SUMMARY_VERSION, byLevel: {}, byMethod: {}, combos: emptyStats(), methods: {} };
  for (const [method, { picks, combos }] of latestByMethod(day)) {
    const m = (out.methods[method] = methodStats());
    for (const p of picks.values()) {
      addResult(m, p.status, p.odds);
      addResult((m.byLevel[p.level] ||= emptyStats()), p.status, p.odds);
      addResult(out, p.status, p.odds);
      addResult((out.byLevel[p.level] ||= emptyStats()), p.status, p.odds);
    }
    for (const k of combos.values()) {
      addResult(m.combos, k.status, k.odds);
      addResult(out.combos, k.status, k.odds);
    }
    const { byLevel: _levels, combos: _combos, ...plain } = m;
    out.byMethod[method] = plain;
  }
  out.pendingAll = out.pending + out.combos.pending;
  return out;
}

// Recalcula los resúmenes de versiones anteriores desde el archivo de cada día.
async function upgradeIndex(index) {
  let changed = false;
  for (const date of Object.keys(index.days || {})) {
    if (index.days[date].v === SUMMARY_VERSION) continue;
    const day = await store.read(dayPath(date));
    if (!day) continue;
    index.days[date] = daySummary(day);
    changed = true;
  }
  return changed;
}

export async function loadIndex({ upgrade = false } = {}) {
  const index = (await store.read(INDEX)) || { days: {}, updated: null };
  if (upgrade && (await upgradeIndex(index)) && store.canWrite()) {
    index.updated = new Date().toISOString();
    await store.write(INDEX, index, 'Historial: resumen por método').catch(() => {});
  }
  return index;
}

async function refreshIndex(days) {
  const index = await loadIndex();
  await upgradeIndex(index);
  for (const day of days) index.days[day.date] = daySummary(day);
  index.updated = new Date().toISOString();
  await store.write(INDEX, index, 'Historial: actualizar resumen');
  return index;
}

// Totales de todos los días: por método (con sus niveles y combinadas) y en conjunto.
export function totals(index) {
  const out = { all: emptyStats(), byLevel: {}, byMethod: {}, combos: emptyStats(), methods: {} };
  const add = (a, b) => {
    for (const k of Object.keys(emptyStats())) a[k] += b[k] || 0;
  };
  for (const s of Object.values(index.days || {})) {
    add(out.all, s);
    add(out.combos, s.combos || {});
    for (const [k, v] of Object.entries(s.byLevel || {})) add((out.byLevel[k] ||= emptyStats()), v);
    for (const [k, v] of Object.entries(s.byMethod || {})) add((out.byMethod[k] ||= emptyStats()), v);
    for (const [method, m] of Object.entries(s.methods || {})) {
      const t = (out.methods[method] ||= methodStats());
      add(t, m);
      add(t.combos, m.combos || {});
      for (const [k, v] of Object.entries(m.byLevel || {})) add((t.byLevel[k] ||= emptyStats()), v);
    }
  }
  return out;
}

export const emptyMethodStats = methodStats;

export const hitRate = (s) => (s.won + s.lost ? s.won / (s.won + s.lost) : null);
export const roi = (s) => (s.staked ? s.profit / s.staked : null);
export { LEVELS };

// ---- Actualizar resultados ----

// Estado de una apuesta con el resultado; si el partido terminó pero no hay
// datos para esa apuesta (p. ej. sin estadísticas de córners), se anula
// pasado el plazo.
export function legStatus(leg, res, now) {
  const status = settle(leg, { ...res, final: now - leg.start > CANCEL_FINAL_MS }, leg.sport);
  if (status) return { status };
  if (res?.state === 'finalizado' && now - leg.start > NO_DATA_MS) return { status: 'void', noData: true };
  return null;
}

function resolveLeg(leg, results, now) {
  if (leg.status !== 'pending') return false;
  const res = results[leg.eventId];
  if (!res) return false;
  const r = legStatus(leg, res, now);
  if (!r) return false;
  leg.status = r.status;
  if (r.noData) leg.noData = true;
  leg.score = res.score;
  return true;
}

// Combinada: perdida si falla una; las medias apuestas multiplican su parte
// (media ganada: (cuota + 1) / 2; media perdida: 1/2).
export function comboStatus(combo) {
  const st = combo.legs.map((l) => l.status);
  if (st.includes('lost')) return 'lost';
  if (st.includes('pending')) return 'pending';
  return st.some((x) => x === 'won' || x === 'half_won' || x === 'half_lost') ? 'won' : 'void';
}

// Cuota final de la combinada: sin las anuladas y con las medias apuestas.
export function comboOdds(combo) {
  return combo.legs.reduce((x, l) => {
    if (l.status === 'void') return x;
    if (l.status === 'half_won') return (x * (l.price + 1)) / 2;
    if (l.status === 'half_lost') return x / 2;
    return x * l.price;
  }, 1);
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
  const fsRecords = {}; // registros de Flashscore de partidos de Sofascore
  const list = [...ids];
  // Partidos con apuestas que necesitan estadísticas o incidencias, y su deporte.
  const detailIds = new Set();
  const sports = new Map();
  for (const day of dayFiles)
    for (const a of day.analyses)
      for (const leg of [...a.picks, ...(a.combos || []).flatMap((k) => k.legs)]) {
        sports.set(leg.eventId, leg.sport);
        if (due(leg) && needsRecord(leg.market)) detailIds.add(leg.eventId);
      }
  for (const { file } of rowFiles) for (const r of file.rows) if (r.y == null && needsRecord(r.market)) (detailIds.add(r.eventId), sports.set(r.eventId, r.sport));
  // Partidos automáticos (Flashscore): resultados publicados cada 2 horas.
  const auto = list.filter(provider.isAuto);
  const starts = new Map();
  for (const day of dayFiles) for (const a of day.analyses) for (const leg of [...a.picks, ...(a.combos || []).flatMap((k) => k.legs)]) starts.set(leg.eventId, leg.start);
  for (const { file } of rowFiles) for (const r of file.rows) starts.set(r.eventId, r.start);
  const dates = new Set(auto.filter((id) => Number.isFinite(starts.get(id))).flatMap((id) => [limaDateOf(starts.get(id)), limaDateOf(starts.get(id) + 86400000)]));
  if (auto.length) onProgress('Resultados publicados', 0.1);
  // Los partidos de Sofascore también pueden tener el registro de Flashscore
  // (GitHub Actions los cruza por nombre).
  const sofa = list.filter((id) => !provider.isAuto(id));
  for (const id of sofa) if (Number.isFinite(starts.get(id))) [0, 1].forEach((d) => dates.add(limaDateOf(starts.get(id) + d * 86400000)));
  for (const date of dates) {
    const published = await provider.loadResults(date, { force: true });
    for (const id of list) {
      const p = published[id];
      if (!p) continue;
      if (provider.isAuto(id)) {
        if (results[id]?.state !== 'finalizado') results[id] = p;
      } else if (p.record) fsRecords[id] ||= { ...p.record, state: p.state };
    }
  }
  // Partidos de Sofascore: con la extensión (y sus estadísticas e incidencias
  // si alguna apuesta las necesita).
  if (sofa.length && !ext.available()) skipped = sofa.filter((id) => !fsRecords[id]).length;
  for (let i = 0; ext.available() && i < sofa.length; i += 10) {
    onProgress(`Sofascore: resultados ${Math.min(i + 10, sofa.length)} de ${sofa.length}`, 0.1 + (0.6 * i) / Math.max(1, sofa.length));
    const chunk = sofa.slice(i, i + 10);
    const detail = chunk.filter((id) => detailIds.has(id));
    const r = await ext.call('sofascore', 'getEventResults', { ids: chunk, urls: Object.fromEntries(chunk.map((id) => [id, urls[id]])), detail }, { timeout: 300000 });
    for (const [id, res] of Object.entries(r.items || {})) {
      const { raw, ...rest } = res;
      results[id] = rest;
      if (raw) results[id].record = recordFromSofascore({ sport: sports.get(id), ...raw });
    }
  }
  // Sofascore + Flashscore: se juntan los dos registros del partido.
  for (const id of sofa) {
    if (!fsRecords[id]) continue;
    const res = results[id] || { state: fsRecords[id].state, score: null };
    const fsRec = { ...fsRecords[id], state: res.state === 'finalizado' ? 'finalizado' : fsRecords[id].state };
    results[id] = { ...res, state: res.state || fsRec.state, record: mergeRecords(res.record || null, fsRec) };
    if (!results[id].record.final && res.score) results[id].record.final = [res.score.home, res.score.away];
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
      const st = legStatus(r, res, now);
      if (!st) continue;
      const status = st.status;
      // Media ganada/perdida: 0.75 / 0.25 (la red aprende la probabilidad de ganar).
      r.y = { won: 1, lost: 0, half_won: 0.75, half_lost: 0.25 }[status] ?? -1;
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
    for (const r of file?.rows || []) if (r.fv === FEATURE_VERSION && r.y >= 0 && r.y <= 1) rows.push(r);
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
