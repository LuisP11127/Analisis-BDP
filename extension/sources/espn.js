// ESPN: noticias de fútbol en español y resultados (incluye Liga 1 de Perú).
import { fetchData } from '../lib/net.js';
import { toIso } from '../lib/model.js';

const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const STATE = { pre: 'pendiente', in: 'en_vivo', post: 'finalizado' };

export async function getNews({ league = 'all' } = {}) {
  const { data, mode } = await fetchData(`${API}/${league}/news?lang=es&region=pe`, { modes: ['direct'] });
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
    })),
  };
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
