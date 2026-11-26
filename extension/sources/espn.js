// ESPN: noticias de fútbol en español y resultados (incluye Liga 1 de Perú).
import { fetchData } from '../lib/net.js';
import { toIso } from '../lib/model.js';

const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const SPORTS_API = 'https://site.api.espn.com/apis/site/v2/sports';

const STATE = { pre: 'pendiente', in: 'en_vivo', post: 'finalizado' };

// Noticias para la red neuronal: fútbol (todas y ligas principales) y las
// ligas grandes de otros deportes. path: "soccer/all", "basketball/nba"...
export const NEWS_PATHS = ['soccer/all', 'soccer/per.1', 'soccer/esp.1', 'soccer/eng.1', 'soccer/ita.1', 'soccer/arg.1', 'soccer/uefa.champions', 'basketball/nba', 'hockey/nhl', 'football/nfl', 'baseball/mlb', 'tennis/atp', 'tennis/wta'];

export async function getNews({ league = 'all', path = null } = {}) {
  const url = path ? `${SPORTS_API}/${path}/news?lang=es&region=pe` : `${API}/${league}/news?lang=es&region=pe`;
  const { data, mode } = await fetchData(url, { modes: ['direct'] });
  return {
    mode,
    items: (data.articles || []).map((a) => ({
      source: 'espn',
      title: a.headline || '',
      summary: a.description || '',
      published: toIso(a.published),
      url: a.links?.web?.href || null,
      image: a.images?.[0]?.url || null,
      section: data.header || '',
      sport: path ? path.split('/')[0] : 'soccer',
    })),
  };
}

// Todas las noticias de NEWS_PATHS (las que fallen se omiten).
export async function getAllNews() {
  const items = [];
  const errors = [];
  for (const path of NEWS_PATHS) {
    try {
      items.push(...(await getNews({ path })).items);
    } catch (e) {
      errors.push(`${path}: ${e.message}`);
    }
  }
  return { mode: 'direct', items, errors };
}

// league: código ESPN, p. ej. "per.1" (Liga 1 Perú), "esp.1", "eng.1", "all".
export async function getMatches({ league = 'per.1', date } = {}) {
  const query = date ? `?dates=${date.replace(/-/g, '')}` : '';
  const { data, mode } = await fetchData(`${API}/${league}/scoreboard${query}`, { modes: ['direct'] });
  const leagueName = data.leagues?.[0]?.name || league;
  return {
    mode,
    items: (data.events || []).map((e) => {
      const comp = e.competitions?.[0] || {};
      const home = comp.competitors?.find((c) => c.homeAway === 'home') || {};
      const away = comp.competitors?.find((c) => c.homeAway === 'away') || {};
      const st = STATE[e.status?.type?.state] || 'otro';
      return {
        source: 'espn',
        id: String(e.id),
        start: toIso(e.date),
        league: leagueName,
        country: '',
        home: home.team?.displayName || '',
        away: away.team?.displayName || '',
        status: st,
        score: st === 'pendiente' ? null : { home: Number(home.score ?? NaN), away: Number(away.score ?? NaN) },
        url: e.links?.[0]?.href || null,
      };
    }),
  };
}

// ---- NBA: partidos, calendario y fichas de jugadores (props de jugador) ----

const NBA = `${SPORTS_API}/basketball/nba`;
const ymd = (date) => String(date).replace(/-/g, '');
const team = (c) => ({ id: String(c?.team?.id ?? ''), name: c?.team?.displayName || '', abbr: c?.team?.abbreviation || '' });

// Partidos de la NBA de un día (fecha de EE. UU.): [{ id, start, state, home, away, score }].
export async function getNbaDay({ date }) {
  const { data } = await fetchData(`${NBA}/scoreboard?dates=${ymd(date)}`, { modes: ['direct'] });
  return (data.events || []).map((e) => {
    const c = e.competitions?.[0] || {};
    const h = c.competitors?.find((x) => x.homeAway === 'home');
    const a = c.competitors?.find((x) => x.homeAway === 'away');
    const state = STATE[e.status?.type?.state] || 'otro';
    return {
      id: String(e.id),
      start: Date.parse(e.date),
      state: e.status?.type?.name === 'STATUS_POSTPONED' ? 'aplazado' : e.status?.type?.name === 'STATUS_CANCELED' ? 'cancelado' : state,
      home: team(h),
      away: team(a),
      score: state === 'pendiente' ? null : [Number(h?.score ?? NaN), Number(a?.score ?? NaN)],
    };
  });
}

// Partidos ya jugados de un equipo en la temporada: [{ id, start }], del más reciente al más antiguo.
export async function getNbaTeamGames({ teamId }) {
  const { data } = await fetchData(`${NBA}/teams/${teamId}/schedule`, { modes: ['direct'] });
  return (data.events || [])
    .filter((e) => e.competitions?.[0]?.status?.type?.completed)
    .map((e) => ({ id: String(e.id), start: Date.parse(e.date) }))
    .sort((a, b) => b.start - a.start);
}

// "6-10" -> [6, 10]
const made = (x) => {
  const m = String(x || '').match(/^(\d+)-(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

// Ficha de un partido: equipos, marcador, jugadores con [min, pts, reb, ast,
// 3pm, 3pa, fgm, fga, ftm, fta] (los que no jugaron, con min 0) y lesionados.
export async function getNbaGame({ id }) {
  const { data } = await fetchData(`${NBA}/summary?event=${id}`, { modes: ['direct'] });
  const comp = data.header?.competitions?.[0] || {};
  const h = comp.competitors?.find((x) => x.homeAway === 'home');
  const a = comp.competitors?.find((x) => x.homeAway === 'away');
  const sideOf = (teamId) => (String(teamId) === String(h?.team?.id) ? 'home' : String(teamId) === String(a?.team?.id) ? 'away' : null);
  const st = comp.status?.type || {};
  const state = st.name === 'STATUS_POSTPONED' ? 'aplazado' : st.name === 'STATUS_CANCELED' ? 'cancelado' : STATE[st.state] || 'otro';
  const players = [];
  for (const t of data.boxscore?.players || []) {
    const side = sideOf(t.team?.id);
    const block = t.statistics?.[0];
    if (!side || !block) continue;
    const col = Object.fromEntries((block.labels || []).map((l, i) => [l, i]));
    for (const p of block.athletes || []) {
      const v = p.stats || [];
      const n = (k) => Number(v[col[k]]) || 0;
      const fg = made(v[col.FG]);
      const tp = made(v[col['3PT']]);
      const ft = made(v[col.FT]);
      const box = v.length ? [n('MIN'), n('PTS'), n('REB'), n('AST'), tp[0], tp[1], fg[0], fg[1], ft[0], ft[1]] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      players.push({ id: String(p.athlete?.id ?? ''), name: p.athlete?.displayName || '', side, starter: Boolean(p.starter), box });
    }
  }
  const injuries = [];
  for (const t of data.injuries || []) {
    const side = sideOf(t.team?.id);
    for (const i of t.injuries || []) if (side && i.athlete?.displayName) injuries.push({ name: i.athlete.displayName, side, status: i.status || i.type?.description || '' });
  }
  return {
    id: String(id),
    start: Date.parse(comp.date),
    state,
    home: team(h),
    away: team(a),
    score: state === 'pendiente' ? null : [Number(h?.score ?? NaN), Number(a?.score ?? NaN)],
    players,
    injuries,
  };
}

export default {
  id: 'espn',
  name: 'ESPN',
  role: 'Noticias en español, resultados de Liga 1',
  async diagnose() {
    const news = await getNews();
    let liga1;
    try {
      liga1 = await getMatches({ league: 'per.1' });
    } catch (e) {
      liga1 = { error: e.message };
    }
    return {
      mode: news.mode,
      count: news.items.length,
      sample: news.items.slice(0, 5),
      details: { liga1: liga1.error ? liga1 : { count: liga1.items.length, sample: liga1.items.slice(0, 3) } },
    };
  },
};
