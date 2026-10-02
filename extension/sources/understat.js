// Understat: goles esperados (xG) por equipo y partido en las 5 grandes
// ligas. Sirve para estimar la fuerza real de cada equipo.
import { fetchData } from '../lib/net.js';

export const LEAGUES = { EPL: 'Premier League', La_liga: 'LaLiga', Bundesliga: 'Bundesliga', Serie_A: 'Serie A', Ligue_1: 'Ligue 1' };

function currentSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const avg = (list, key) => (list.length ? list.reduce((s, x) => s + Number(x[key] || 0), 0) / list.length : null);

// Promedios de xG a favor/en contra de los últimos `lastN` partidos de cada equipo.
export async function getTeamStrength({ league = 'EPL', season = currentSeason(), lastN = 6 } = {}) {
  const { data, mode } = await fetchData(`https://understat.com/getLeagueData/${league}/${season}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    pageUrl: `https://understat.com/league/${league}`,
  });
  const items = Object.values(data.teams || {}).map((t) => {
    const recent = (t.history || []).slice(-lastN);
    return {
      source: 'understat',
      league: LEAGUES[league] || league,
      team: t.title,
      matches: (t.history || []).length,
      xgFor: avg(recent, 'xG'),
      xgAgainst: avg(recent, 'xGA'),
      goalsFor: avg(recent, 'scored'),
      goalsAgainst: avg(recent, 'missed'),
      points: (t.history || []).reduce((s, h) => s + Number(h.pts || 0), 0),
    };
  });
  const fixtures = (data.dates || [])
    .filter((d) => !d.isResult)
    .map((d) => ({ home: d.h?.title, away: d.a?.title, datetime: d.datetime, forecast: d.forecast || null }));
  return { mode, items, fixtures };
}

export default {
  id: 'understat',
  name: 'Understat',
  role: 'xG (goles esperados) de las 5 grandes ligas',
  async diagnose() {
    const { mode, items, fixtures } = await getTeamStrength({ league: 'EPL' });
    const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
    return {
      mode,
      count: items.length,
      sample: items
        .sort((a, b) => b.xgFor - b.xgAgainst - (a.xgFor - a.xgAgainst))
        .slice(0, 5)
        .map((t) => ({ ...t, xgFor: round(t.xgFor), xgAgainst: round(t.xgAgainst) })),
      details: { upcomingFixtures: fixtures.length, nextFixture: fixtures[0] || null },
    };
  },
};
