// Flashscore (versión Perú): partidos y resultados del día y noticias.
// Los datos salen de un "feed" de texto con registros separados por "~",
// campos por "¬" y clave/valor por "÷". Requiere la cabecera x-fsign.
import { fetchData } from '../lib/net.js';
import { toIso } from '../lib/model.js';

const PAGE = 'https://www.flashscore.pe/';
const FEED = 'https://global.flashscore.ninja/203/x/feed'; // 203 = flashscore.pe
const HEADERS = { 'x-fsign': 'SW9D1eZo' };
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

function feed(name) {
  return fetchData(`${FEED}/${name}`, { pageUrl: PAGE, headers: HEADERS, as: 'text' });
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
      });
    }
  }
  return { mode, items };
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
  return { start: row.start, home, gf, ga, r: r || 'D', opp: home ? row.away : row.home, league: row.league };
}

// ev: partido con home.id / away.id de Flashscore. Devuelve los datos que usa el modelo.
export async function getH2H({ fsId, homeId, awayId }) {
  const { data } = await feed(`df_hh_1_${fsId}`);
  const sections = parseH2H(data);
  const last = (teamId) => {
    const s = sections.find((x) => /ltimos partidos/i.test(x.title) && x.rows.some((row) => row.homeId === teamId || row.awayId === teamId));
    return (s?.rows || []).filter((row) => row.hs != null && row.as != null).map((row) => toLast(row, teamId)).sort((a, b) => b.start - a.start);
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
  const { data, mode } = await fetchData(`${FEED}/nl_1_59`, { pageUrl: PAGE, headers: HEADERS });
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
