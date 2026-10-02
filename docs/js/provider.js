// Datos automáticos: los publica GitHub Actions cada 2 horas en data/fuente/
// (partidos y resultados de Flashscore, cuotas de Apuesta Total, xG de
// Understat). Funcionan en cualquier dispositivo, sin la extensión.
import { expandDay, expandResult } from './data-format.js';
import { addDays, limaDateOf } from './util.js';

const BASE = 'data/fuente';
const MAX_AGE = 10 * 60000; // se vuelven a pedir después de 10 minutos

let index = null; // { at, data }
const days = new Map(); // "fecha|deporte" -> { at, data }
const results = new Map(); // fecha -> { at, data }

export const isAuto = (id) => String(id).startsWith('fs:');

async function getJson(path) {
  const resp = await fetch(`${BASE}/${path}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`HTTP ${resp.status} al leer ${path}`);
  return resp.json();
}

const fresh = (entry, force) => entry && !force && Date.now() - entry.at < MAX_AGE;

// { generated, today, days: { fecha: { deporte: { events, withOdds } } } } o null.
export async function loadIndex({ force = false } = {}) {
  if (fresh(index, force)) return index.data;
  try {
    index = { at: Date.now(), data: await getJson('indice.json') };
  } catch {
    index = { at: Date.now(), data: null };
  }
  return index.data;
}

export const cachedIndex = () => index?.data || null;

// Partidos de un día y deporte, con cuotas, últimos partidos y xG. null si
// ese día no se recolectó (solo hay hoy y mañana).
export async function loadDay(date, sport, { force = false } = {}) {
  const key = `${date}|${sport}`;
  if (fresh(days.get(key), force)) return days.get(key).data;
  const idx = await loadIndex({ force });
  if (!idx?.days?.[date]?.[sport]) return null;
  const raw = await getJson(`${date}/${sport}.json`);
  const data = raw ? expandDay(raw) : null;
  days.set(key, { at: Date.now(), data });
  return data;
}

// Datos ya cargados de un partido (para el análisis).
export function lookup(ev) {
  for (const { data } of days.values()) {
    if (!data || data.sport !== ev.sport || !data.events.some((e) => e.id === ev.id)) continue;
    return { offers: data.offers.get(ev.id) || [], details: data.details.get(ev.id) || null, xg: data.xg.get(ev.id) || null, generated: data.generated };
  }
  return null;
}

// Busca los datos de los partidos aunque su día no esté abierto en la página.
export async function detailsFor(events) {
  const out = new Map();
  for (const ev of events) {
    let found = lookup(ev);
    const date = limaDateOf(ev.start);
    for (const d of [date, addDays(date, -1), addDays(date, 1)]) {
      if (found) break;
      await loadDay(d, ev.sport).catch(() => null);
      found = lookup(ev);
    }
    out.set(ev.id, found);
  }
  return out;
}

// Resultados finales de un día: { id: { state, score, winner } }.
export async function loadResults(date, { force = false } = {}) {
  if (fresh(results.get(date), force)) return results.get(date).data;
  let data = {};
  try {
    const raw = await getJson(`resultados/${date}.json`);
    data = Object.fromEntries(Object.entries(raw || {}).map(([id, r]) => [id, expandResult(r)]));
  } catch {
    // sin resultados publicados para ese día
  }
  results.set(date, { at: Date.now(), data });
  return data;
}
