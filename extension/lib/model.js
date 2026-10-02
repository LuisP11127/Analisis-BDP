// Formato común de los datos que devuelve cada fuente.
//
// Partido:
//   { source, id, start (ISO), league, country, home, away,
//     status: 'pendiente' | 'en_vivo' | 'finalizado' | 'otro',
//     score: { home, away } | null, url }
// Cuota:
//   { source, eventId, start, league, home, away,
//     markets: [{ name, selections: [{ name, price }] }] }

// Convierte "6/5" (cuota fraccional) en 2.2 (cuota decimal).
export function fractionalToDecimal(frac) {
  if (typeof frac === 'number') return frac;
  const [a, b] = String(frac).split('/').map(Number);
  if (!b) return Number(frac) || null;
  return Math.round((1 + a / b) * 100) / 100;
}

// Clave para emparejar equipos entre fuentes: sin tildes, minúsculas y sin
// sufijos genéricos ("FC", "CF", "Club"...).
export function teamKey(name = '') {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|cd|club|deportivo|de|futbol|football|calcio|ss|fk|sk)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function toIso(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function limaDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d); // AAAA-MM-DD
}

// Busca recursivamente objetos que cumplan `test` dentro de un JSON cualquiera.
export function findAll(root, test, limit = 5000) {
  const out = [];
  const stack = [root];
  const seen = new Set();
  while (stack.length && out.length < limit) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (!Array.isArray(v) && test(v)) out.push(v);
    for (const child of Array.isArray(v) ? v : Object.values(v)) if (child && typeof child === 'object') stack.push(child);
  }
  return out;
}
