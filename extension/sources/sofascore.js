// Sofascore: partidos, forma, enfrentamientos directos, alineaciones
// (con jugadores ausentes/lesionados) y cuotas de referencia.
import { fetchData } from '../lib/net.js';
import { fractionalToDecimal, limaDate, toIso } from '../lib/model.js';

const PAGE = 'https://www.sofascore.com/es/futbol';
// En modo directo se usa el API; dentro de la pestaña, la misma ruta en www (mismo origen).
const API_DIRECT = 'https://api.sofascore.com/api/v1';
const API_TAB = 'https://www.sofascore.com/api/v1';

async function get(path) {
  try {
    return await fetchData(`${API_DIRECT}${path}`, { modes: ['direct'] });
  } catch (direct) {
    try {
      return await fetchData(`${API_TAB}${path}`, { pageUrl: PAGE, modes: ['tab'] });
    } catch (tab) {
      tab.message = `${direct.message} | ${tab.message}`;
      throw tab;
    }
  }
}

const STATUS = { notstarted: 'pendiente', inprogress: 'en_vivo', finished: 'finalizado' };

function toMatch(e) {
  const finishedOrLive = e.status?.type === 'finished' || e.status?.type === 'inprogress';
  return {
    source: 'sofascore',
    id: String(e.id),
    start: toIso(e.startTimestamp),
    league: e.tournament?.uniqueTournament?.name || e.tournament?.name || '',
    country: e.tournament?.category?.name || '',
    home: e.homeTeam?.name || '',
    away: e.awayTeam?.name || '',
    homeId: e.homeTeam?.id,
    awayId: e.awayTeam?.id,
    status: STATUS[e.status?.type] || 'otro',
    score: finishedOrLive ? { home: e.homeScore?.current ?? null, away: e.awayScore?.current ?? null } : null,
    url: e.slug && e.customId ? `https://www.sofascore.com/es/football/match/${e.slug}/${e.customId}#id:${e.id}` : null,
  };
}

export async function getMatches({ date = limaDate() } = {}) {
  const { data, mode } = await get(`/sport/football/scheduled-events/${date}`);
  return { mode, items: (data.events || []).map(toMatch) };
}

function missingPlayers(side) {
  return (side?.missingPlayers || []).map((m) => ({
    player: m.player?.name || m.player?.shortName || '',
    position: m.player?.position || '',
    type: m.type || '', // "missing" (baja segura) o "doubtful" (duda)
    reason: m.description || m.reason || '',
  }));
}

function oddsMarkets(data) {
  return (data?.markets || []).map((m) => ({
    name: [m.marketName, m.choiceGroup].filter(Boolean).join(' '),
    selections: (m.choices || []).map((c) => ({ name: c.name, price: fractionalToDecimal(c.fractionalValue) })),
  }));
}

// Detalles de un partido. Cada parte es opcional: si una falla, se informa
// el error y se devuelve el resto.
export async function getMatchDetails({ eventId }) {
  const parts = {
    form: `/event/${eventId}/pregame-form`,
    h2h: `/event/${eventId}/h2h`,
    lineups: `/event/${eventId}/lineups`,
    odds: `/event/${eventId}/odds/1/all`,
  };
  const out = { eventId, errors: {} };
  await Promise.all(
    Object.entries(parts).map(async ([key, path]) => {
      try {
        out[key] = (await get(path)).data;
      } catch (e) {
        out.errors[key] = e.message;
      }
    }),
  );
  return {
    eventId,
    form: out.form
      ? {
          home: { form: out.form.homeTeam?.form || [], position: out.form.homeTeam?.position, avgRating: out.form.homeTeam?.avgRating },
          away: { form: out.form.awayTeam?.form || [], position: out.form.awayTeam?.position, avgRating: out.form.awayTeam?.avgRating },
        }
      : null,
    h2h: out.h2h?.teamDuel ? { homeWins: out.h2h.teamDuel.homeWins, draws: out.h2h.teamDuel.draws, awayWins: out.h2h.teamDuel.awayWins } : null,
    missing: out.lineups ? { home: missingPlayers(out.lineups.home), away: missingPlayers(out.lineups.away), confirmed: !!out.lineups.confirmed } : null,
    odds: out.odds ? oddsMarkets(out.odds) : null,
    errors: out.errors,
  };
}

export default {
  id: 'sofascore',
  name: 'Sofascore',
  role: 'Partidos, forma, H2H, bajas y lesiones',
  async diagnose() {
    const { mode, items } = await getMatches();
    const upcoming = items.find((m) => m.status === 'pendiente') || items[0];
    const details = upcoming ? await getMatchDetails({ eventId: upcoming.id }) : null;
    return { mode, count: items.length, sample: items.slice(0, 5), details };
  },
};
