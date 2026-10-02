// Apuesta Total: cuotas. El sportsbook lo provee kmianko:
//  1) /api/pulse/snapshot/events      -> todos los eventos (todos los deportes)
//  2) /api/eventlist/eu/markets/all   -> mercados y cuotas de una lista de eventos
// No requieren cuenta y funcionan también desde los servidores de GitHub.
import { fetchData } from '../lib/net.js';

const BASE = 'https://prod20392.kmianko.com';
const PAGE = `${BASE}/es-pe/spbkv3?operatorToken=logout`;
const IDS_PER_REQUEST = 10;

// Tipos de mercado que usa el propio sportsbook. Fútbol: 1X2, doble
// oportunidad, total de goles y ambos anotan. Resto: ganador, total y hándicap.
const MARKET_TYPES = {
  football: ['ML0', 'ML39', 'OU200', 'OU249', 'QA61', 'QA158'],
  default: ['ML0', 'OU0', 'HC0', 'ML39', 'OU39', 'HC39'],
};

// Nombre del deporte en Apuesta Total para cada deporte de Sofascore.
const SPORT_NAMES = {
  football: ['Fútbol'],
  basketball: ['Baloncesto'],
  tennis: ['Tenis'],
  baseball: ['Béisbol'],
  'ice-hockey': ['Ice Hockey', 'Hockey sobre hielo', 'Hockey'],
  'american-football': ['Fútbol Americano'],
  volleyball: ['Voleibol'],
  handball: ['Balonmano'],
  futsal: ['Fútbol Rápido', 'Futsal', 'Fútbol Sala'],
  'table-tennis': ['Tenis de Mesa'],
  esports: ['E-sports+', 'eSports', 'E-Sports'],
  rugby: ['Unión de Rugby', 'Liga de Rugby', 'Rugby'],
  cricket: ['Críquet'],
  mma: ['MMA'],
  darts: ['Dardos'],
  snooker: ['Snooker'],
  badminton: ['Bádminton'],
  waterpolo: ['Waterpolo'],
  'beach-volley': ['Voleibol de playa'],
};

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Las cuotas exigen una sesión anónima: al abrir la página el sitio entrega
// las cookies `authorization` y `session`. En el navegador se guardan y se
// envían solas; fuera de él (Node) se leen de set-cookie y se mandan como
// encabezados, igual que hace el propio sportsbook.
let sessionHeaders = null;

async function ensureSession(force = false) {
  if (sessionHeaders && !force) return sessionHeaders;
  const resp = await fetch(PAGE, { credentials: 'include', signal: AbortSignal.timeout(25000) });
  const setCookies = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [];
  const jar = {};
  for (const c of setCookies) {
    const pair = c.split(';')[0];
    jar[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1);
  }
  sessionHeaders = { 'time-area': '01', ...(jar.authorization ? { authorization: jar.authorization, session: jar.session } : {}) };
  return sessionHeaders;
}

const get = async (path, { session = false } = {}) => {
  const headers = session ? await ensureSession() : {};
  try {
    return await fetchData(`${BASE}${path}`, { pageUrl: PAGE, headers });
  } catch (e) {
    if (!session || e.status !== 403) throw e;
    return fetchData(`${BASE}${path}`, { pageUrl: PAGE, headers: await ensureSession(true) }); // sesión vencida
  }
};

// El parámetro `t` solo admite ciertos valores; `hPNl` es el que usa el sportsbook.
const SNAPSHOT_PATHS = ['/api/pulse/snapshot/events?lang=ES-PE&t=hPNl', '/api/pulse/snapshot/events?lang=ES-PE'];
const SNAPSHOT_TTL = 3 * 60000;
let snapshotCache = null;

async function snapshot() {
  if (snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL) return snapshotCache;
  let lastError;
  for (const path of SNAPSHOT_PATHS) {
    try {
      const { data, mode } = await get(path);
      snapshotCache = { at: Date.now(), data: Array.isArray(data) ? data : [], mode };
      return snapshotCache;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function toEvent(e) {
  const home = e.Participants?.find((p) => p.VenueRole === 'Home') || e.Participants?.[0];
  const away = e.Participants?.find((p) => p.VenueRole === 'Away') || e.Participants?.[1];
  return {
    source: 'apuestatotal',
    eventId: String(e._id),
    start: e.StartEventDate,
    sport: e.SportName || '',
    league: e.LeagueName || '',
    country: e.RegionName || '',
    topLeague: Boolean(e.IsTopLeague),
    leagueOrder: e.LeagueOrder ?? Infinity,
    live: Boolean(e.IsLive),
    home: home?.Name || '',
    away: away?.Name || '',
  };
}

// Lista ligera de eventos de un deporte (sin cuotas) entre `from` y `to` (ms).
export async function getEventList({ sport = 'football', from = 0, to = Infinity } = {}) {
  const { data, mode } = await snapshot();
  const names = (SPORT_NAMES[sport] || []).map(norm);
  const items = data
    .filter((e) => e.Type === 'Fixture' && !e.IsSuspended && names.includes(norm(e.SportName)))
    .filter((e) => e.StartEventDate >= from && e.StartEventDate <= to)
    .map(toEvent);
  return { mode, items };
}

function toMarket(m) {
  return {
    name: m.Name || m.MarketType?.Name || '',
    type: m.MarketType?._id || '',
    selections: (m.Selections || [])
      .filter((s) => !s.IsDisabled && !s.IsRemoved)
      .map((s) => ({
        name: s.BetslipLine || s.Name || '',
        outcome: s.OutcomeType || '',
        side: s.Side ?? null,
        price: Number(s.DisplayOdds?.Decimal ?? s.TrueOdds),
      }))
      .filter((s) => s.price > 1),
  };
}

// Mercados y cuotas de una lista de eventos: { [eventId]: [mercado, ...] }.
export async function getMarkets({ eventIds = [], sport = 'football' } = {}) {
  const types = MARKET_TYPES[sport] || MARKET_TYPES.default;
  const items = {};
  const errors = [];
  for (let i = 0; i < eventIds.length; i += IDS_PER_REQUEST) {
    const ids = eventIds.slice(i, i + IDS_PER_REQUEST);
    const query = encodeURIComponent(`${ids.join('|')}:${types.join('|')}`);
    try {
      const { data } = await get(`/api/eventlist/eu/markets/all?markets=${query}`, { session: true });
      for (const m of Array.isArray(data) ? data : []) {
        if (m.IsRemoved || m.IsSuspended) continue;
        (items[String(m.EventId)] ||= []).push(toMarket(m));
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { items, errors };
}

// Partidos de fútbol de las próximas `hours` horas con sus cuotas (diagnóstico).
export async function getOdds({ hours = 24, limit = 60 } = {}) {
  const now = Date.now();
  const { mode, items } = await getEventList({ sport: 'football', from: now, to: now + hours * 3600000 });
  const events = items
    .filter((e) => !e.live)
    .sort((a, b) => b.topLeague - a.topLeague || a.leagueOrder - b.leagueOrder || a.start - b.start)
    .slice(0, limit);
  const { items: markets, errors } = await getMarkets({ eventIds: events.map((e) => e.eventId), sport: 'football' });
  const withOdds = events.map((e) => ({ ...e, markets: markets[e.eventId] || [] })).filter((e) => e.markets.length);
  return { mode, totalEvents: items.length, items: withOdds, errors };
}

export default {
  id: 'apuestatotal',
  name: 'Apuesta Total',
  role: 'Cuotas (1X2, doble oportunidad, goles, ambos anotan, hándicap)',
  async diagnose() {
    const { mode, totalEvents, items, errors } = await getOdds({ limit: 20 });
    const otherSports = {};
    for (const sport of ['basketball', 'tennis', 'baseball']) {
      const now = Date.now();
      otherSports[sport] = (await getEventList({ sport, from: now, to: now + 86400000 })).items.length;
    }
    return {
      mode,
      count: items.length,
      sample: items.slice(0, 3),
      details: {
        footballEventsNext24h: totalEvents,
        otherSportsNext24h: otherSports,
        marketNames: [...new Set(items.flatMap((e) => e.markets.map((m) => `${m.type} = ${m.name}`)))],
        errors,
      },
    };
  },
};
