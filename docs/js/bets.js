// Apuestas demo: saldo ficticio (S/ 10 000 al empezar), apuestas simples y
// combinadas con las cuotas de las casas, y liquidación con los mismos
// resultados que los picks (al tocar "Actualizar resultados").
//
// Archivo (dentro de docs/, en GitHub o en el navegador):
//   data/apuestas/demo.json             billetera: { v, id, initial, created, bets }
//   data/apuestas/archivo/<id>.json     billeteras anteriores (al reiniciar el saldo)
//
// Apuesta: { id, created, kind: 'simple' | 'combinada', stake, odds, status,
//            payout, legs: [{ eventId, sport, start, match, league, url, market,
//            sel, line, label, marketName, price, source, status, score }] }
import * as store from './storage.js';
import { comboOdds, comboStatus } from './analysis/outcomes.js';

export const DEMO = 'data/apuestas/demo.json';
export const archivePath = (id) => `data/apuestas/archivo/${id}.json`;
export const INITIAL = 10000; // soles demo al empezar o al reiniciar
export const MIN_STAKE = 1;
export const MAX_LEGS = 20; // selecciones por combinada

const round2 = (x) => Math.round(x * 100) / 100;
export const legKey = (l) => `${l.eventId}|${l.market}|${l.sel}|${l.line ?? ''}`;

export function newWallet(now = Date.now()) {
  return { v: 1, id: `w${now.toString(36)}`, initial: INITIAL, created: new Date(now).toISOString(), bets: [] };
}

// Cuota total (combinada: producto de las cuotas).
export const totalOdds = (legs) => legs.reduce((x, l) => x * l.price, 1);

// Estado y pago (lo que vuelve a la billetera, incluido el monto) de una
// apuesta según sus selecciones. Medias apuestas: la mitad gana o se devuelve.
export function settleBet(bet) {
  if (bet.kind === 'combinada') {
    const status = comboStatus(bet);
    if (status === 'pending') return { status, payout: null };
    return { status, payout: status === 'lost' ? 0 : round2(bet.stake * comboOdds(bet)) };
  }
  const { status, price } = bet.legs[0];
  const factor = { won: price, half_won: (price + 1) / 2, void: 1, half_lost: 0.5, lost: 0 }[status];
  return factor == null ? { status: 'pending', payout: null } : { status, payout: round2(bet.stake * factor) };
}

// Saldo y totales de la billetera.
export function walletSummary(w) {
  const out = { initial: w?.initial ?? INITIAL, balance: 0, staked: 0, returned: 0, open: 0, openCount: 0, won: 0, lost: 0, void: 0, settled: 0 };
  for (const b of w?.bets || []) {
    out.staked += b.stake;
    if (b.status === 'pending') {
      out.open += b.stake;
      out.openCount++;
      continue;
    }
    out.returned += b.payout || 0;
    out.settled++;
    if (b.status === 'void') out.void++;
    else if ((b.payout || 0) > b.stake) out.won++;
    else out.lost++;
  }
  out.balance = round2(out.initial - out.staked + out.returned);
  out.profit = round2(out.returned - (out.staked - out.open));
  return out;
}

// Apuestas del boleto, validadas. selections: las del boleto; kind: 'simple'
// (un monto por selección en stakes) o 'combinada' (un monto en stake).
export function buildBets(selections, { kind, stake, stakes = [] }, balance, now = Date.now()) {
  const errors = [];
  if (!selections.length) errors.push('Agrega al menos una selección al boleto');
  for (const s of selections) if (!(s.start > now)) errors.push(`${s.match}: el partido ya empezó`);
  const legOf = (s) => ({ ...s, status: 'pending', score: null });
  const created = new Date(now).toISOString();
  let bets = [];
  if (kind === 'combinada') {
    if (selections.length < 2) errors.push('Una combinada necesita al menos 2 selecciones');
    if (selections.length > MAX_LEGS) errors.push(`Una combinada admite hasta ${MAX_LEGS} selecciones`);
    if (new Set(selections.map((s) => s.eventId)).size < selections.length) errors.push('No se pueden combinar selecciones del mismo partido');
    if (!(stake >= MIN_STAKE)) errors.push(`El monto mínimo es S/ ${MIN_STAKE}`);
    bets = [{ id: `b${now.toString(36)}`, created, kind, stake: round2(stake), odds: totalOdds(selections), status: 'pending', payout: null, legs: selections.map(legOf) }];
  } else {
    selections.forEach((s, i) => {
      if (!(stakes[i] >= MIN_STAKE)) errors.push(`${s.label}: el monto mínimo es S/ ${MIN_STAKE}`);
    });
    bets = selections.map((s, i) => ({ id: `b${now.toString(36)}${i}`, created, kind: 'simple', stake: round2(stakes[i] || 0), odds: s.price, status: 'pending', payout: null, legs: [legOf(s)] }));
  }
  const total = bets.reduce((x, b) => x + b.stake, 0);
  if (!errors.length && total > balance + 1e-9) errors.push(`Saldo insuficiente: apuestas S/ ${total.toFixed(2)} y tienes S/ ${balance.toFixed(2)}`);
  return { bets: errors.length ? [] : bets, total: round2(total), errors };
}

// Une dos copias de la misma billetera (por ejemplo, la de GitHub, que justo
// después de guardar puede llegar sin el último cambio, y la de la página).
// Por apuesta vale la más avanzada (liquidada o con más selecciones liquidadas).
const progress = (b) => (b.status !== 'pending' ? 1000 : 0) + b.legs.filter((l) => l.status !== 'pending').length;
export function mergeWallets(a, b) {
  if (!a) return b;
  if (!b || a.id !== b.id) return a;
  const byId = new Map(a.bets.map((x) => [x.id, x]));
  for (const x of b.bets) if (!byId.has(x.id) || progress(x) > progress(byId.get(x.id))) byId.set(x.id, x);
  return { ...a, bets: [...byId.values()].sort((x, y) => String(x.created).localeCompare(String(y.created)) || x.id.localeCompare(y.id)) };
}

export async function loadWallet({ fresh = false } = {}) {
  const w = await store.read(DEMO, { fresh });
  return Array.isArray(w?.bets) ? w : null;
}

// Guarda apuestas nuevas: lee la última versión, la une con la que muestra la
// página (known) y vuelve a comprobar el saldo antes de guardar.
export async function placeBets(bets, known = null) {
  const file = await loadWallet({ fresh: true });
  const w = mergeWallets(file || known || newWallet(), known && file ? known : null);
  const total = bets.reduce((x, b) => x + b.stake, 0);
  const { balance } = walletSummary(w);
  if (total > balance + 1e-9) throw new Error(`Saldo insuficiente: apuestas S/ ${total.toFixed(2)} y tienes S/ ${balance.toFixed(2)}`);
  w.bets = [...w.bets, ...bets];
  await store.write(DEMO, w, `Apuestas demo: ${bets.length === 1 ? '1 apuesta' : `${bets.length} apuestas`} por S/ ${total.toFixed(2)}`);
  return w;
}

// Reinicia el saldo: la billetera actual se guarda en el archivo y empieza otra.
export async function resetWallet() {
  const file = await loadWallet({ fresh: true });
  if (file?.bets.length) await store.write(archivePath(file.id), file, 'Apuestas demo: archivar billetera');
  const w = newWallet();
  await store.write(DEMO, w, `Apuestas demo: saldo reiniciado (S/ ${INITIAL})`);
  return w;
}

// Selecciones pendientes de todas las apuestas abiertas (para liquidarlas).
export const pendingLegs = (w) => (w?.bets || []).filter((b) => b.status === 'pending').flatMap((b) => b.legs.filter((l) => l.status === 'pending'));

// Recalcula estado y pago de las apuestas abiertas. Devuelve cuántas se liquidaron.
export function settleWallet(w) {
  let settled = 0;
  for (const b of w?.bets || []) {
    if (b.status !== 'pending') continue;
    const r = settleBet(b);
    if (r.status === 'pending') continue;
    Object.assign(b, r, { settledAt: new Date().toISOString() });
    settled++;
  }
  return settled;
}

// Guarda la billetera después de liquidar, sin perder apuestas hechas mientras
// tanto (si el saldo se reinició en otro dispositivo, no se toca).
export async function saveSettled(w) {
  const file = await loadWallet({ fresh: true });
  if (file && file.id !== w.id) return file;
  const merged = mergeWallets(file || w, file ? w : null);
  await store.write(DEMO, merged, 'Apuestas demo: resultados');
  return merged;
}
