// Sofascore: partidos de todos los deportes, estadísticas previas de cada
// partido (forma, últimos resultados, H2H, bajas, votos, cuotas de referencia)
// y resultados finales para liquidar apuestas.
import { fetchMany, FetchError } from '../lib/net.js';
import { fractionalToDecimal, limaDate } from '../lib/model.js';

const PAGE = 'https://www.sofascore.com/';
const API = 'https://www.sofascore.com/api/v1';
const API_DIRECT = 'https://api.sofascore.com/api/v1';

const limaDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(ms));

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Orden de intentos: api.sofascore.com directo, www.sofascore.com directo,
// dentro de una pestaña de Sofascore y, como último recurso, abriendo cada
// dirección en la pestaña. `required(path)` marca las peticiones que deben
// existir: si fallan (aunque sea con 404) se pasa al siguiente intento.
let apiHostWorks = null;

async function getMany(paths, required = () => false) {
  const reqs = (base) => paths.map((p) => ({ url: base + p, required: required(p) }));
  const notes = [];
  if (apiHostWorks !== false) {
    try {
      const r = await fetchMany(reqs(API_DIRECT), { modes: ['direct'] });
      const req = r.results.filter((_, j) => required(paths[j]));
      const failed = req.length ? req.every((x) => !x.ok) : r.results.filter((x) => !x.ok).length > r.results.length / 2;
      if (!failed) {
        apiHostWorks = true;
        return { ...r, mode: 'direct-api', notes };
      }
      const bad = req[0] || r.results[0];
      notes.push(`api.sofascore.com: ${bad.error}`);
      // Un 404 puede ser un día sin partidos: solo se descarta ante un bloqueo.
      if (bad.status !== 404) apiHostWorks = false;
    } catch (e) {
      notes.push(`api.sofascore.com: ${e.message}`);
      apiHostWorks = false;
    }
  }
  const r = await fetchMany(reqs(API), { pageUrl: PAGE, modes: ['direct', 'tab', 'navigate'] });
  return { ...r, notes: [...notes, ...r.notes] };
}

const STATE = {
  notstarted: 'pendiente',
  inprogress: 'en_vivo',
  finished: 'finalizado',
  postponed: 'aplazado',
  canceled: 'cancelado',
  interrupted: 'interrumpido',
  suspended: 'interrumpido',
};

function team(t = {}) {
  return {
    id: t.id,
    name: t.name || '',
    short: t.shortName || t.name || '',
    alpha2: t.country?.alpha2 || null,
    ranking: t.ranking ?? null,
    national: Boolean(t.national),
  };
}

function score(s) {
  return s?.current == null ? null : s;
}

export function toEvent(e, sport) {
  const ut = e.tournament?.uniqueTournament;
  const cat = e.tournament?.category || {};
  const hs = score(e.homeScore);
  const as = score(e.awayScore);
  return {
    id: e.id,
    sport,
    start: e.startTimestamp * 1000,
    tournament: {
      id: ut?.id ?? e.tournament?.id ?? null,
      name: ut?.name || e.tournament?.name || '',
      priority: e.tournament?.priority ?? 0,
    },
    category: { id: cat.id ?? null, name: cat.name || '', alpha2: cat.alpha2 || cat.country?.alpha2 || null },
    home: team(e.homeTeam),
    away: team(e.awayTeam),
    state: STATE[e.status?.type] || 'otro',
    statusText: e.status?.description || '',
    score: hs && as ? { home: hs.current, away: as.current, homeNT: hs.normaltime ?? null, awayNT: as.normaltime ?? null } : null,
    winner: e.winnerCode ?? null,
    url: e.slug && e.customId ? `https://www.sofascore.com/${e.slug}/${e.customId}#id:${e.id}` : null,
  };
}

// Partidos de un deporte para un día en hora de Lima. Sofascore agrupa por día
// UTC, así que se piden dos días y se filtra.
export async function getSportEvents({ sport = 'football', date = limaDate() } = {}) {
  const { mode, results, notes } = await getMany([`/sport/${sport}/scheduled-events/${date}`, `/sport/${sport}/scheduled-events/${addDays(date, 1)}`], () => true);
  if (results.every((r) => !r.ok)) {
    const r = results[0];
    // Un deporte sin partidos ese día responde 404: no es un error.
    if (results.every((x) => x.status === 404)) return { mode, items: [], notes: [...notes, `${mode}: 404 en todos los intentos`] };
    const via = { 'direct-api': 'api directo', direct: 'directo', tab: 'en pestaña', navigate: 'navegando' }[mode] || mode;
    throw new FetchError(`Sofascore respondió ${r.error} (${via})${notes.length ? ` · antes: ${notes.join(' | ')}` : ''}`, { status: r.status, mode, snippet: r.snippet });
  }
  const events = new Map();
  for (const r of results) {
    for (const e of r.ok ? r.data.events || [] : []) {
      if (!events.has(e.id) && limaDay(e.startTimestamp * 1000) === date) events.set(e.id, toEvent(e, sport));
    }
  }
  return { mode, notes, items: [...events.values()].sort((a, b) => a.start - b.start) };
}

// Últimos partidos jugados por un equipo, del más reciente al más antiguo.
// En fútbol se usa el marcador de los 90 minutos (sin prórroga ni penales).
function lastMatches(data, teamId, sport, before) {
  const regular = sport === 'football' || sport === 'futsal';
  return (data?.events || [])
    .filter((e) => e.status?.type === 'finished' && e.startTimestamp * 1000 < before)
    .sort((a, b) => b.startTimestamp - a.startTimestamp)
    .slice(0, 15)
    .map((e) => {
      const isHome = e.homeTeam?.id === teamId;
      const pick = (s) => (regular ? s?.normaltime ?? s?.current : s?.current) ?? null;
      const [hs, as] = [pick(e.homeScore), pick(e.awayScore)];
      const gf = isHome ? hs : as;
      const ga = isHome ? as : hs;
      let r;
      if (regular && gf != null && ga != null) r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      else r = e.winnerCode === 3 ? 'D' : e.winnerCode === (isHome ? 1 : 2) ? 'W' : 'L';
      return {
        start: e.startTimestamp * 1000,
        home: isHome,
        gf,
        ga,
        r,
        opp: (isHome ? e.awayTeam : e.homeTeam)?.name || '',
        league: e.tournament?.uniqueTournament?.name || e.tournament?.name || '',
      };
    });
}

function missingPlayers(side) {
  return (side?.missingPlayers || []).map((m) => ({
    player: m.player?.name || m.player?.shortName || '',
    position: m.player?.position || '',
    type: m.type || '', // "missing" (baja segura) o "doubtful" (duda)
    reason: m.description || '',
  }));
}

function oddsMarkets(data) {
  return (data?.markets || []).map((m) => ({
    name: m.marketName || '',
    group: m.choiceGroup ?? null,
    live: Boolean(m.isLive),
    choices: (m.choices || [])
      .map((c) => ({ name: String(c.name), price: fractionalToDecimal(c.fractionalValue) }))
      .filter((c) => c.price > 1),
  }));
}

function votes(data) {
  const v = data?.vote;
  if (!v) return null;
  const total = (v.vote1 || 0) + (v.voteX || 0) + (v.vote2 || 0);
  return total ? { home: (v.vote1 || 0) / total, draw: (v.voteX || 0) / total, away: (v.vote2 || 0) / total, total } : null;
}

const DETAIL_PARTS = ['pregame-form', 'h2h', 'lineups', 'odds/1/all', 'votes'];

// Estadísticas previas de varios partidos en una sola tanda de peticiones.
// events: [{ id, sport, homeId, awayId, start }]
export async function getEventDetails({ events = [] } = {}) {
  const paths = [];
  const index = [];
  const teamIdx = new Map();
  for (const ev of events) {
    for (const part of DETAIL_PARTS) {
      index.push({ ev: ev.id, part });
      paths.push(`/event/${ev.id}/${part}`);
    }
    for (const id of [ev.homeId, ev.awayId]) {
      if (id && !teamIdx.has(id)) {
        teamIdx.set(id, paths.length);
        index.push({ team: id });
        paths.push(`/team/${id}/events/last/0`);
      }
    }
  }
  const { mode, results } = await getMany(paths, (p) => p.startsWith('/team/'));
  const raw = {};
  results.forEach((r, i) => {
    const { ev, part } = index[i];
    if (ev && r.ok) (raw[ev] ||= {})[part] = r.data;
  });
  const teamData = (id) => (teamIdx.has(id) && results[teamIdx.get(id)].ok ? results[teamIdx.get(id)].data : null);

  const items = {};
  for (const ev of events) {
    const d = raw[ev.id] || {};
    const form = d['pregame-form'];
    const duel = d.h2h?.teamDuel;
    items[ev.id] = {
      form: form
        ? {
            home: { form: form.homeTeam?.form || [], position: form.homeTeam?.position ?? null, avgRating: Number(form.homeTeam?.avgRating) || null },
            away: { form: form.awayTeam?.form || [], position: form.awayTeam?.position ?? null, avgRating: Number(form.awayTeam?.avgRating) || null },
          }
        : null,
      h2h: duel ? { homeWins: duel.homeWins || 0, draws: duel.draws || 0, awayWins: duel.awayWins || 0 } : null,
      missing: d.lineups ? { home: missingPlayers(d.lineups.home), away: missingPlayers(d.lineups.away), confirmed: Boolean(d.lineups.confirmed) } : null,
      odds: d['odds/1/all'] ? oddsMarkets(d['odds/1/all']) : null,
      votes: votes(d.votes),
      lastHome: lastMatches(teamData(ev.homeId), ev.homeId, ev.sport, ev.start),
      lastAway: lastMatches(teamData(ev.awayId), ev.awayId, ev.sport, ev.start),
    };
  }
  const failed = results.filter((r) => !r.ok && r.status !== 404).length;
  return { mode, items, failed, requests: results.length };
}

// Estado y marcador final de varios partidos (para liquidar apuestas).
export async function getEventResults({ ids = [] } = {}) {
  const { mode, results } = await getMany(
    ids.map((id) => `/event/${id}`),
    () => true,
  );
  const items = {};
  results.forEach((r, i) => {
    if (!r.ok || !r.data?.event) return;
    const e = toEvent(r.data.event, null);
    items[ids[i]] = { state: e.state, score: e.score, winner: e.winner };
  });
  return { mode, items };
}

// Compatibilidad con la primera versión del diagnóstico.
export async function getMatches({ date = limaDate() } = {}) {
  return getSportEvents({ sport: 'football', date });
}

export default {
  id: 'sofascore',
  name: 'Sofascore',
  role: 'Partidos de todos los deportes, forma, H2H, bajas y lesiones',
  async diagnose() {
    const { mode, items, notes } = await getSportEvents({ sport: 'football' });
    // Siempre hay partidos de fútbol: una lista vacía significa que algo falló.
    if (!items.length) throw new Error(`Sofascore no devolvió partidos de fútbol para hoy (${mode}). Intentos: ${notes.join(' | ') || 'ninguno'}`);
    const upcoming = items.find((m) => m.state === 'pendiente') || items[0];
    let details = null;
    if (upcoming) {
      const r = await getEventDetails({
        events: [{ id: upcoming.id, sport: 'football', homeId: upcoming.home.id, awayId: upcoming.away.id, start: upcoming.start }],
      });
      const d = r.items[upcoming.id];
      details = {
        partido: `${upcoming.home.name} vs ${upcoming.away.name}`,
        peticionesFallidas: r.failed,
        forma: d.form,
        h2h: d.h2h,
        bajas: d.missing,
        votos: d.votes,
        mercadosCuotas: (d.odds || []).map((m) => `${m.name}${m.group ? ` ${m.group}` : ''}`).slice(0, 15),
        ultimosLocal: d.lastHome.slice(0, 3),
        ultimosVisita: d.lastAway.slice(0, 3),
      };
    }
    let basket = null;
    try {
      basket = (await getSportEvents({ sport: 'basketball' })).items.length;
    } catch (e) {
      basket = e.message;
    }
    const sample = items.slice(0, 5).map((e) => ({
      start: new Date(e.start).toISOString(),
      league: e.tournament.name,
      country: e.category.name,
      home: e.home.name,
      away: e.away.name,
      status: e.state,
      score: e.score,
    }));
    return { mode, count: items.length, sample, details: { intentosPrevios: notes, ...details, partidosBasquet: basket } };
  },
};
