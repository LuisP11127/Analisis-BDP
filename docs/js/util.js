// Utilidades compartidas por la página y por las pruebas (Node).

export const TZ = 'America/Lima';

const ymdFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

export const limaToday = () => ymdFormat.format(new Date());
export const limaDateOf = (ms) => ymdFormat.format(new Date(ms));

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Acepta milisegundos, segundos o una fecha ISO.
export function toMs(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  return Date.parse(v);
}

export const fmtTime = (ms) =>
  new Intl.DateTimeFormat('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

export const fmtDateTime = (ms) =>
  new Intl.DateTimeFormat('es-PE', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(ms),
  );

export const fmtDay = (ymd) => {
  const s = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${ymd}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const logit = (p) => {
  const q = clamp(p, 1e-4, 1 - 1e-4);
  return Math.log(q / (1 - q));
};
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const round = (x, d = 2) => (x == null || Number.isNaN(x) ? x : Math.round(x * 10 ** d) / 10 ** d);
export const pct = (p) => `${Math.round(p * 100)}%`;
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

export function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

// Función de distribución acumulada de la normal estándar.
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

// Bandera a partir del código de país de dos letras.
const SPECIAL_FLAGS = { EN: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', SX: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', WA: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' };
export function flag(alpha2) {
  if (!alpha2) return '🌍';
  const code = alpha2.toUpperCase();
  if (SPECIAL_FLAGS[code]) return SPECIAL_FLAGS[code];
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Crea elementos del DOM: h('div', { class: 'x', onclick }, 'texto', otroNodo).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// Generador pseudoaleatorio con semilla (resultados reproducibles).
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
