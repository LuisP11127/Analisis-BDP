// Flashscore (versión Perú): partidos y resultados del día y noticias.
// Los datos salen de un "feed" de texto con registros separados por "~",
// campos por "¬" y clave/valor por "÷". Requiere la cabecera x-fsign.
import { FetchError, fetchDirect, runInSiteTab } from '../lib/net.js';
import { toIso } from '../lib/model.js';

const PAGE = 'https://www.flashscore.pe/';
// Dirección del "feed" (203 = flashscore.pe). Con la extensión los datos se
// piden desde una pestaña de flashscore.pe, por la misma vía que usa la propia
// página (así funciona desde cualquier red); en GitHub Actions, directo.
const FEED_BASES = ['https://global.flashscore.ninja/203/x/feed', 'https://203.flashscore.ninja/203/x/feed', 'https://d.flashscore.pe/x/feed'];
const HEADERS = { 'x-fsign': 'SW9D1eZo' };
const inExtension = typeof chrome !== 'undefined' && Boolean(chrome?.scripting);
const TZ_LIMA = -5;
const STATUS = { 1: 'pendiente', 2: 'en_vivo', 3: 'finalizado' };

export function parseFeed(text) {
  return text
    .split('~')
    .filter(Boolean)
    .map((record) => {
      const fields = {};
      for (const part of record.split('¬')) {
        const i = part.indexOf('÷');
        if (i > 0) fields[part.slice(0, i)] = part.slice(i + 1);
      }
      return fields;
    });
}

// Corre dentro de flashscore.pe: usa la dirección del feed que usa la página
// (la ve en sus pedidos) y pide cada feed de `names`.
export async function feedsInPage(names, headers, bases) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seenBases = () => [
    ...new Set(
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.includes('/x/feed/'))
        .map((u) => u.slice(0, u.indexOf('/x/feed/') + '/x/feed'.length)),
    ),
  ];
  // La página pide sus feeds al cargar: se espera un poco a verlos.
  for (let i = 0; i < 16 && !seenBases().length; i++) await sleep(500);
  const seen = seenBases();
  const candidates = [...new Set([...seen, ...bases, `${location.origin}/x/feed`])];
  const get = async (base, name) => {
    for (const credentials of ['omit', 'include']) {
      try {
        const resp = await fetch(`${base}/${name}`, { headers, credentials });
        return { status: resp.status, text: resp.ok ? await resp.text() : null };
      } catch (e) {
        if (credentials === 'include') return { status: 0, error: String(e?.message || e) };
      }
    }
    return { status: 0, error: 'sin respuesta' };
  };
  // Primera dirección que responde (con el primer feed pedido).
  const tried = [];
  let base = null;
  let first = null;
  for (const b of candidates) {
    const r = await get(b, names[0]);
    if (r.status) {
      base = b;
      first = r;
      break;
    }
    tried.push(`${b}: ${r.error}`);
  }
  if (!base) return { ok: false, tried, seen };
  const texts = { [names[0]]: first.text };
  const failed = first.text == null ? { [names[0]]: `HTTP ${first.status}` } : {};
  for (const name of names.slice(1)) {
    const r = await get(base, name);
    texts[name] = r.text ?? null;
    if (r.text == null) failed[name] = r.error || `HTTP ${r.status}`;
  }
  return { ok: true, base, texts, failed, seen };
}

let pageBase = null; // dirección que usa flashscore.pe (para empezar por ella)

// Sin extensión (GitHub Actions): directo, con la dirección que funcionó y un
// corte si Flashscore deja de responder (para no esperar pedido por pedido).
let directBase = FEED_BASES[0];
let failures = 0;
let pausedUntil = 0;
async function directFeed(name) {
  if (Date.now() < pausedUntil) throw new FetchError('Flashscore no responde (pausa de 2 minutos)', { mode: 'direct', url: `${directBase}/${name}` });
  const bases = [directBase, ...FEED_BASES.filter((b) => b !== directBase)];
  let last;
  // Solo se prueban otras direcciones si la conocida falla y aún no hay racha de fallos.
  for (const base of failures ? bases.slice(0, 1) : bases) {
    try {
      const text = await fetchDirect(`${base}/${name}`, { headers: HEADERS, as: 'text', timeout: 12000 });
      directBase = base;
      failures = 0;
      return text;
    } catch (e) {
      if (e.status) {
        failures = 0;
        return null; // la dirección responde: ese feed no existe
      }
      last = e;
    }
  }
  if (++failures >= 5) {
    pausedUntil = Date.now() + 120000;
    failures = 0;
  }
  throw new FetchError(`Flashscore no responde: ${last?.message}`, { mode: 'direct', url: `${directBase}/${name}` });
}

// Varios feeds a la vez: { nombre: texto o null (sin datos) }.
async function feeds(names) {
  if (!names.length) return { texts: {}, mode: inExtension ? 'tab' : 'direct' };
  if (!inExtension) {
    const texts = {};
    for (const name of names) texts[name] = await directFeed(name);
    return { texts, mode: 'direct' };
  }
  let r;
  try {
    r = await runInSiteTab(PAGE, feedsInPage, [names, HEADERS, [pageBase, ...FEED_BASES].filter(Boolean)]);
  } catch (e) {
    r = { ok: false, tried: [e.message] };
  }
  if (!r?.ok) {
    throw new FetchError(`No se pudieron leer los datos desde flashscore.pe: ${(r?.tried || ['la pestaña no respondió']).join(' | ')}`, {
      mode: 'tab',
      url: PAGE,
      snippet: r?.seen?.length ? `La página usa: ${r.seen.join(', ')}` : 'La página no hizo pedidos a su feed (¿cargó bien flashscore.pe?)',
    });
  }
  pageBase = r.base;
  return { texts: r.texts, mode: 'tab', base: r.base };
}

async function feed(name) {
  const { texts, mode } = await feeds([name]);
  if (texts[name] == null) throw new FetchError(`Flashscore: sin datos para ${name}`, { mode, url: PAGE });
  return { data: texts[name], mode };
}

// day: 0 = hoy, 1 = mañana, -1 = ayer (hora de Lima).
export async function getMatches({ day = 0 } = {}) {
  const { data, mode } = await feed(`f_1_${day}_${TZ_LIMA}_es-pe_1`);
  const items = [];
  let league = { name: '', country: '' };
  for (const r of parseFeed(data)) {
    if (r.ZA) {
      const [country, ...rest] = r.ZA.split(': ');
      league = { name: rest.join(': ') || r.ZA, country: r.ZY || country };
    } else if (r.AA) {
      const status = STATUS[r.AB] || 'otro';
      items.push({
        source: 'flashscore',
        id: r.AA,
        start: toIso(Number(r.AD)),
        league: league.name,
        country: league.country,
        home: r.AE || '',
        away: r.AF || '',
        status,
        score: status === 'pendiente' ? null : { home: r.AG !== undefined ? Number(r.AG) : null, away: r.AH !== undefined ? Number(r.AH) : null },
        url: `https://www.flashscore.pe/partido/${r.AA}/`,
      });
    }
  }
  return { mode, items };
}

// ---- Partidos de cualquier deporte en el formato de la página ----

// Número de cada deporte en los feeds de Flashscore.
export const SPORT_IDS = {
  football: 1,
  tennis: 2,
  basketball: 3,
  'ice-hockey': 4,
  'american-football': 5,
  baseball: 6,
  handball: 7,
  rugby: 8,
  floorball: 9,
  futsal: 11,
  volleyball: 12,
  cricket: 13,
  darts: 14,
  snooker: 15,
  'aussie-rules': 18,
  'table-tennis': 25,
  mma: 28,
  esports: 36,
};

// Estado detallado (AC): 4 aplazado, 5 cancelado.
function stateOf(r) {
  if (r.AC === '4') return 'aplazado';
  if (r.AC === '5') return 'cancelado';
  return STATUS[r.AB] || 'otro';
}

const num = (v) => (v === undefined || v === '' ? null : Number(v));

// Campos de la fila con el marcador de cada periodo (BA/BB = 1.er periodo...).
const PERIOD_FIELDS = ['BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BK', 'BL', 'BM', 'BN', 'BO', 'BP', 'BQ', 'BR', 'AG', 'AH'];
const periodFields = (r) => Object.fromEntries(PERIOD_FIELDS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));

// day: 0 = hoy, 1 = mañana, -1 = ayer (hora de Lima). Devuelve partidos con la
// misma forma que los de Sofascore (id con prefijo "fs:").
export async function getSportDay({ sport = 'football', day = 0 } = {}) {
  const sportId = SPORT_IDS[sport];
  if (!sportId) return { items: [] };
  const { data, mode } = await feed(`f_${sportId}_${day}_${TZ_LIMA}_es-pe_1`);
  const items = [];
  let league = null;
  for (const r of parseFeed(data)) {
    if (r.ZA) {
      const i = r.ZA.indexOf(': ');
      league = { id: r.ZEE || r.ZC || r.ZA, country: i > 0 ? r.ZA.slice(0, i) : r.ZY || '', name: i > 0 ? r.ZA.slice(i + 2) : r.ZA };
    } else if (r.AA && league && r.AE && r.AF) {
      const state = stateOf(r);
      const hs = num(r.AG);
      const as = num(r.AH);
      items.push({
        id: `fs:${r.AA}`,
        source: 'flashscore',
        sport,
        start: Number(r.AD) * 1000,
        tournament: { id: league.id, name: league.name, priority: 0 },
        category: { id: null, name: league.country, alpha2: null },
        home: { id: r.PX || null, name: r.AE, short: r.AE, slug: r.WU || null, alpha2: null, ranking: null, national: false },
        away: { id: r.PY || null, name: r.AF, short: r.AF, slug: r.WV || null, alpha2: null, ranking: null, national: false },
        state,
        statusText: '',
        score: hs != null && as != null && state !== 'pendiente' ? { home: hs, away: as, homeNT: null, awayNT: null } : null,
        winner: null,
        url: `https://www.flashscore.pe/partido/${r.AA}/`,
        ...(state === 'finalizado' ? { fsRow: periodFields(r) } : {}),
      });
    }
  }
  return { mode, items };
}

// Feeds de detalle de un partido (texto sin procesar; se interpretan en
// docs/js/analysis/records.js): st estadísticas, sui incidencias y marcador
// por periodo, mh punto a punto (tenis). Un feed vacío es "sin datos".
export async function getMatchFeeds({ fsId, kinds = ['st', 'sui'] } = {}) {
  const id = String(fsId).replace(/^fs:/, '');
  const out = {};
  try {
    const { texts } = await feeds(kinds.map((k) => `df_${k}_1_${id}`));
    for (const k of kinds) out[k] = texts[`df_${k}_1_${id}`] ?? null;
  } catch {
    for (const k of kinds) out[k] = null; // error: se reintenta en la próxima corrida
  }
  return out;
}

// Para partidos de Sofascore (con la extensión): H2H de Flashscore y las
// estadísticas de los últimos partidos de cada equipo (texto de df_st; la
// página las interpreta). fsId: id del partido en Flashscore.
export async function getTeamFeeds({ fsId, homeId, awayId, n = 6 } = {}) {
  const h2h = await getH2H({ fsId: String(fsId).replace(/^fs:/, ''), homeId, awayId });
  const ids = [...new Set([...h2h.lastHome.slice(0, n), ...h2h.lastAway.slice(0, n)].map((m) => m.fsId).filter(Boolean))];
  const st = {};
  if (ids.length) {
    const { texts } = await feeds(ids.map((id) => `df_st_1_${id}`));
    for (const id of ids) if (texts[`df_st_1_${id}`] != null) st[id] = texts[`df_st_1_${id}`];
  }
  return { ...h2h, st };
}

// Últimos partidos de cada equipo y enfrentamientos directos de un partido
// (pestaña "General" del H2H). fsId: id de Flashscore sin el prefijo.
export function parseH2H(text) {
  const sections = [];
  let blocks = 0;
  let current = null;
  for (const r of parseFeed(text)) {
    if (r.KA !== undefined) {
      blocks++;
      if (blocks > 1) break; // solo la pestaña "General"
    } else if (r.KB !== undefined) {
      current = { title: r.KB, rows: [] };
      sections.push(current);
    } else if (r.KC !== undefined && current) {
      current.rows.push({
        id: r.KP || null,
        start: Number(r.KC) * 1000,
        homeId: r.UQ || null,
        awayId: r.UO || null,
        home: (r.KJ || '').replace(/^\*/, ''),
        away: (r.KK || '').replace(/^\*/, ''),
        hs: num(r.KU),
        as: num(r.KT),
        focusHome: r.KS === 'home',
        result: r.WIS || null, // w / l / d para el equipo de la sección
        league: r.KF || '',
      });
    }
  }
  return sections;
}

// Convierte una fila del H2H en "último partido" del equipo `teamId`.
function toLast(row, teamId) {
  const home = row.homeId ? row.homeId === teamId : row.focusHome;
  const gf = home ? row.hs : row.as;
  const ga = home ? row.as : row.hs;
  let r = { w: 'W', l: 'L', d: 'D' }[row.result?.[0]];
  if (!r && gf != null && ga != null) r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
  return { start: row.start, home, gf, ga, r: r || 'D', opp: home ? row.away : row.home, league: row.league, fsId: row.id || null };
}

// ev: partido con home.id / away.id de Flashscore. Devuelve los datos que usa el modelo.
export async function getH2H({ fsId, homeId, awayId }) {
  const { data } = await feed(`df_hh_1_${fsId}`);
  return h2hData(parseH2H(data), homeId, awayId);
}

// Últimos partidos de cada equipo y balance de enfrentamientos a partir de las
// secciones del H2H.
export function h2hData(sections, homeId, awayId) {
  // La sección de cada equipo es la de "Últimos partidos" donde aparece en
  // (casi) todas las filas; en la del rival solo aparece si se enfrentaron.
  const plays = (row, teamId) => row.homeId === teamId || row.awayId === teamId;
  const last = (teamId) => {
    const count = (x) => x.rows.filter((row) => plays(row, teamId)).length;
    const s = sections.filter((x) => /ltimos partidos/i.test(x.title)).sort((a, b) => count(b) - count(a))[0];
    if (!s || !teamId || count(s) < s.rows.length / 2) return [];
    return s.rows
      .filter((row) => row.hs != null && row.as != null && plays(row, teamId))
      .map((row) => toLast(row, teamId))
      .sort((a, b) => b.start - a.start);
  };
  const duel = sections.find((x) => /enfrentamientos/i.test(x.title));
  let h2h = null;
  if (duel?.rows.length) {
    h2h = { homeWins: 0, draws: 0, awayWins: 0 };
    for (const row of duel.rows) {
      if (row.hs == null || row.as == null) continue;
      if (row.hs === row.as) h2h.draws++;
      else {
        const winner = row.hs > row.as ? row.homeId : row.awayId;
        if (winner === homeId) h2h.homeWins++;
        else if (winner === awayId) h2h.awayWins++;
      }
    }
  }
  return { lastHome: last(homeId), lastAway: last(awayId), h2h };
}

export async function getNews() {
  const { data: text, mode } = await feed('nl_1_59');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const items = [];
  for (const section of data?.data?.sections || []) {
    for (const a of section.articles || []) {
      items.push({
        source: 'flashscore',
        title: a.title || a.name || '',
        summary: a.perex || a.description || '',
        published: toIso(a.published || a.publishedAt || a.date),
        url: a.url ? new URL(a.url, PAGE).href : null,
        image: a.image?.url || a.images?.[0]?.url || null,
        section: section.name,
      });
    }
  }
  return { mode, items };
}

export default {
  id: 'flashscore',
  name: 'Flashscore',
  role: 'Partidos y resultados del día, noticias',
  async diagnose() {
    const matches = await getMatches();
    let news;
    try {
      news = await getNews();
    } catch (e) {
      news = { error: e.message };
    }
    return {
      mode: matches.mode,
      count: matches.items.length,
      sample: matches.items.slice(0, 5),
      details: { news: news.error ? news : { count: news.items.length, sample: news.items.slice(0, 3) } },
    };
  },
};
