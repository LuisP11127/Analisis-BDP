// FotMob: partidos del día por liga y noticias destacadas.
import { fetchData } from '../lib/net.js';
import { limaDate, toIso } from '../lib/model.js';

const PAGE = 'https://www.fotmob.com/es';
const API = 'https://www.fotmob.com/api';

function status(s = {}) {
  if (s.cancelled) return 'otro';
  if (s.finished) return 'finalizado';
  if (s.started || s.ongoing) return 'en_vivo';
  return 'pendiente';
}

export async function getMatches({ date = limaDate() } = {}) {
  const ymd = date.replace(/-/g, '');
  const { data, mode } = await fetchData(`${API}/data/matches?date=${ymd}&timezone=America/Lima`, { pageUrl: PAGE });
  const items = [];
  for (const league of data.leagues || []) {
    for (const m of league.matches || []) {
      const st = status(m.status);
      items.push({
        source: 'fotmob',
        id: String(m.id),
        start: toIso(m.status?.utcTime || m.time),
        league: league.parentLeagueName || league.name || '',
        country: league.ccode || '',
        home: m.home?.name || '',
        away: m.away?.name || '',
        status: st,
        score: st === 'pendiente' ? null : { home: m.home?.score ?? null, away: m.away?.score ?? null },
        url: m.pageUrl ? `https://www.fotmob.com${m.pageUrl}` : `https://www.fotmob.com/match/${m.id}`,
      });
    }
  }
  return { mode, items };
}

export async function getNews() {
  const { data, mode } = await fetchData(`${API}/trendingnews?lang=es`, { pageUrl: PAGE });
  const list = Array.isArray(data) ? data : data.news || data.articles || [];
  return {
    mode,
    items: list.map((a) => ({
      source: 'fotmob',
      title: a.title || '',
      summary: a.lead || a.summary || '',
      published: toIso(a.gmtTime || a.published),
      url: a.page?.url ? new URL(a.page.url, 'https://www.fotmob.com').href : a.url || null,
      image: a.imageUrl || null,
    })),
  };
}

export default {
  id: 'fotmob',
  name: 'FotMob',
  role: 'Partidos por liga, noticias destacadas',
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
