// Empareja el mismo partido entre fuentes (Sofascore, Apuesta Total, Betano,
// Understat). Los nombres cambian de una a otra ("CA Independiente" vs
// "Independiente", "Bélgica" vs "Belgium"), así que se comparan por palabras,
// se traducen los países y se exige que la hora de inicio coincida.
import { toMs } from '../util.js';

const STOP = new Set(
  'fc cf sc ac afc cd ca club de del la el los las the fk sk sv if bk ik sd ud rc rcd cs us as ss ssd sl ec se ad cr fbc bc vfb vfl tsg kv kvc krc y and'.split(
    ' ',
  ),
);
const ALIASES = { utd: 'united', st: 'saint', ste: 'sainte', intl: 'international' };
const RESERVE = new Set(['b', 'ii', 'iii', 'reserves', 'reservas', 'res']);
const WOMEN = new Set(['w', 'women', 'womens', 'fem', 'femenino', 'femenina', 'f', 'ladies', 'damas']);

// Países con nombres que no salen bien de Intl.DisplayNames o no son regiones ISO.
const EXTRA_COUNTRIES = {
  turkey: 'tr', turkiye: 'tr', usa: 'us', eeuu: 'us', 'estados unidos': 'us', 'united states': 'us',
  'korea republic': 'kr', 'south korea': 'kr', 'corea del sur': 'kr', 'republica de corea': 'kr',
  'north korea': 'kp', 'corea del norte': 'kp', 'czech republic': 'cz', 'republica checa': 'cz', chequia: 'cz', czechia: 'cz',
  'ivory coast': 'ci', 'costa de marfil': 'ci', 'cote divoire': 'ci', england: 'eng', inglaterra: 'eng', scotland: 'sco', escocia: 'sco',
  wales: 'wal', gales: 'wal', 'northern ireland': 'nir', 'irlanda del norte': 'nir', 'republic of ireland': 'ie', ireland: 'ie', irlanda: 'ie',
  holland: 'nl', netherlands: 'nl', 'paises bajos': 'nl', holanda: 'nl', 'bosnia and herzegovina': 'ba', 'bosnia y herzegovina': 'ba',
  'bosnia herzegovina': 'ba', 'north macedonia': 'mk', 'macedonia del norte': 'mk', 'dr congo': 'cd', 'rd congo': 'cd',
  'cape verde': 'cv', 'cabo verde': 'cv', 'chinese taipei': 'tw', 'hong kong': 'hk', uae: 'ae', 'emiratos arabes unidos': 'ae',
  russia: 'ru', rusia: 'ru', iran: 'ir', syria: 'sy', siria: 'sy', vietnam: 'vn', moldova: 'md', moldavia: 'md',
  'saudi arabia': 'sa', 'arabia saudi': 'sa', 'arabia saudita': 'sa', kosovo: 'xk', 'faroe islands': 'fo', 'islas feroe': 'fo',
};

export function basicNorm(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let countries = null;
function countryCodes() {
  if (countries) return countries;
  countries = new Map();
  try {
    const names = ['es', 'en'].map((l) => new Intl.DisplayNames([l], { type: 'region', fallback: 'none' }));
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        for (const dn of names) {
          const name = dn.of(code);
          if (name && name !== code) countries.set(basicNorm(name), code.toLowerCase());
        }
      }
    }
  } catch {
    // Sin Intl.DisplayNames solo se usan los nombres de EXTRA_COUNTRIES.
  }
  for (const [k, v] of Object.entries(EXTRA_COUNTRIES)) countries.set(k, v);
  return countries;
}

// Palabras clave de un nombre de equipo: sin artículos ni siglas genéricas,
// con marcas de categoría (femenino, sub-21, reserva) separadas.
export function nameTokens(name) {
  let s = basicNorm(name).replace(/\b(?:u|sub)\s?(\d{2})\b/g, 'u$1');
  const words = s.split(' ').filter(Boolean);
  const markers = [];
  const rest = [];
  for (const w of words) {
    if (WOMEN.has(w)) markers.push('fem');
    else if (/^u\d\d$/.test(w)) markers.push(w);
    else if (RESERVE.has(w)) markers.push('res');
    else rest.push(w);
  }
  const base = rest.join(' ');
  const country = countryCodes().get(base);
  const core = country ? [`#${country}`] : rest.map((w) => ALIASES[w] || w).filter((w) => !STOP.has(w));
  return { core: core.length ? core : rest, markers: [...new Set(markers)].sort().join(',') };
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function sameWord(x, y) {
  if (x === y) return true;
  if (x.startsWith('#') || y.startsWith('#')) return false;
  if (x.length === 1 || y.length === 1) return x[0] === y[0]; // inicial, p. ej. "C. Alcaraz"
  if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  return Math.min(x.length, y.length) >= 6 && levenshtein(x, y) <= 1;
}

// 0 = nada que ver, 1 = mismo nombre.
export function similarity(a, b) {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (A.markers !== B.markers || !A.core.length || !B.core.length) return 0;
  const used = new Set();
  let common = 0;
  for (const x of A.core) {
    const j = B.core.findIndex((y, i) => !used.has(i) && sameWord(x, y));
    if (j >= 0) {
      used.add(j);
      common++;
    }
  }
  const dice = (2 * common) / (A.core.length + B.core.length);
  const subset = common / Math.min(A.core.length, B.core.length);
  return Math.max(dice, 0.9 * subset);
}

const teamSimilarity = (team, name) => Math.max(similarity(team.name, name), team.short ? similarity(team.short, name) : 0);

// Busca en `list` (eventos de otra fuente con { start, home, away }) el mismo
// partido que `ev` (evento de Sofascore). Devuelve { item, score, swapped } o null.
export function matchEvent(ev, list, { toleranceMin = 20, minScore = 0.55 } = {}) {
  let best = null;
  for (const item of list) {
    const dt = Math.abs(toMs(item.start) - ev.start) / 60000;
    if (!(dt <= toleranceMin)) continue;
    const hh = teamSimilarity(ev.home, item.home);
    const aa = teamSimilarity(ev.away, item.away);
    const ha = teamSimilarity(ev.home, item.away);
    const ah = teamSimilarity(ev.away, item.home);
    const swapped = Math.min(ha, ah) > Math.min(hh, aa);
    const [s1, s2] = swapped ? [ha, ah] : [hh, aa];
    if (Math.min(s1, s2) < 0.4) continue;
    const score = (s1 + s2) / 2 - dt / 600;
    if (score >= minScore && (!best || score > best.score)) best = { item, score, swapped };
  }
  return best;
}

// Equipo con el nombre más parecido (para cruzar con Understat).
export function bestByName(name, items, key = 'team', min = 0.6) {
  let best = null;
  for (const item of items) {
    const s = similarity(name, item[key]);
    if (s >= min && (!best || s > best.s)) best = { item, s };
  }
  return best?.item || null;
}
