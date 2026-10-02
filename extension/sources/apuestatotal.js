// Apuesta Total: cuotas de fútbol. El sportsbook lo provee kmianko:
//  1) /api/pulse/snapshot/events      -> todos los eventos (todos los deportes)
//  2) /api/eventlist/eu/markets/all   -> mercados y cuotas de una lista de eventos
// Ambos funcionan sin iniciar sesión, también desde los servidores de GitHub.
import { fetchData } from '../lib/net.js';
import { toIso } from '../lib/model.js';

const BASE = 'https://prod20392.kmianko.com';
const PAGE = `${BASE}/es-pe/spbkv3?operatorToken=logout`;
const FOOTBALL = '1';
// Tipos de mercado de fútbol que usa el propio sportsbook:
// 1X2, doble oportunidad, más/menos goles y ambos equipos anotan.
const MARKET_TYPES = ['ML0', 'ML39', 'OU200', 'OU249', 'QA61', 'QA158'];
const IDS_PER_REQUEST = 10;

const get = (path) => fetchData(`${BASE}${path}`, { pageUrl: PAGE });

function toEvent(e) {
  const home = e.Participants?.find((p) => p.VenueRole === 'Home') || e.Participants?.[0];
  const away = e.Participants?.find((p) => p.VenueRole === 'Away') || e.Participants?.[1];
  return {
    source: 'apuestatotal',
    eventId: String(e._id),
    start: toIso(e.StartEventDate),
    league: e.LeagueName || '',
    country: e.RegionName || '',
    topLeague: !!e.IsTopLeague,
    leagueOrder: e.LeagueOrder ?? Infinity,
    live: !!e.IsLive,
    home: home?.Name || '',
    away: away?.Name || '',
    markets: [],
  };
}

// Partidos de fútbol que empiezan en las próximas `hours` horas, priorizando
// las ligas principales. `limit` acota cuántos se consultan después.
export async function getEvents({ hours = 24, includeLive = false } = {}) {
  const { data, mode } = await get(`/api/pulse/snapshot/events?lang=ES-PE&t=${Math.random().toString(36).slice(2, 6)}`);
  const now = Date.now();
  const until = now + hours * 3600000;
  const items = (Array.isArray(data) ? data : [])
    .filter((e) => e.SportId === FOOTBALL && e.Type === 'Fixture' && !e.IsSuspended)
    .filter((e) => (includeLive ? true : !e.IsLive) && e.StartEventDate <= until && (e.IsLive || e.StartEventDate >= now))
    .map(toEvent)
    .sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start.localeCompare(b.start));
  return { mode, items };
}

function toMarket(m) {
  return {
    name: m.Name || m.MarketType?.Name || '',
    type: m.MarketType?._id || '',
    selections: (m.Selections || [])
      .filter((s) => !s.IsDisabled && !s.IsRemoved)
      .map((s) => ({ name: s.BetslipLine || s.Name || '', outcome: s.OutcomeType || '', price: Number(s.DisplayOdds?.Decimal ?? s.TrueOdds) }))
      .filter((s) => s.price > 1),
  };
}

export async function getOdds({ hours = 24, limit = 60 } = {}) {
  const { mode, items } = await getEvents({ hours });
  const events = items.slice(0, limit);
  const byId = new Map(events.map((e) => [e.eventId, e]));
  const errors = [];
  for (let i = 0; i < events.length; i += IDS_PER_REQUEST) {
    const ids = events.slice(i, i + IDS_PER_REQUEST).map((e) => e.eventId);
    const query = encodeURIComponent(`${ids.join('|')}:${MARKET_TYPES.join('|')}`);
    try {
      const { data } = await get(`/api/eventlist/eu/markets/all?markets=${query}`);
      for (const m of Array.isArray(data) ? data : []) {
        if (m.IsRemoved || m.IsSuspended) continue;
        byId.get(String(m.EventId))?.markets.push(toMarket(m));
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { mode, totalEvents: items.length, items: events.filter((e) => e.markets.length), errors };
}

export default {
  id: 'apuestatotal',
  name: 'Apuesta Total',
  role: 'Cuotas (1X2, doble oportunidad, goles, ambos anotan)',
  async diagnose() {
    const { mode, totalEvents, items, errors } = await getOdds({ limit: 20 });
    return {
      mode,
      count: items.length,
      sample: items.slice(0, 3),
      details: {
        footballEventsNext24h: totalEvents,
        marketNames: [...new Set(items.flatMap((e) => e.markets.map((m) => `${m.type} = ${m.name}`)))],
        errors,
      },
    };
  },
};
