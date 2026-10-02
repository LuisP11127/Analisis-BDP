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
