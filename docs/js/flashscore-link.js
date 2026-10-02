// Partidos de Sofascore + Flashscore (con la extensión): se busca cada partido
// en Flashscore por nombres y hora para sumar sus datos:
//  - al analizar: estadísticas de los últimos partidos de cada equipo;
//  - al liquidar: incidencias y estadísticas del partido terminado.
import * as ext from './ext.js';
import { matchEvent } from './analysis/matching.js';
import { parseFsGames, parseFsIncidents, parseFsStats, recordFromFlashscore, recordFromSofascore } from './analysis/records.js';
import { mergeTeamStats, teamStatsFrom } from './analysis/teamstats.js';
import { groupBy, limaDateOf, limaToday } from './util.js';

const STAT_SPORTS = new Set(['football', 'basketball', 'ice-hockey', 'tennis', 'baseball', 'american-football', 'handball']);
const dayOffset = (ms) => Math.round((Date.parse(`${limaDateOf(ms)}T12:00:00Z`) - Date.parse(`${limaToday()}T12:00:00Z`)) / 86400000);

// Partidos de Flashscore del deporte y día de cada evento: Map(id -> partido de Flashscore).
export async function findOnFlashscore(events) {
  const out = new Map();
  for (const [key, evs] of groupBy(events, (e) => `${e.sport}|${dayOffset(e.start)}`)) {
    const [sport, day] = key.split('|');
    if (Math.abs(Number(day)) > 7) continue;
    let list = [];
    try {
      list = (await ext.call('flashscore', 'getSportDay', { sport, day: Number(day) }, { timeout: 60000 })).items || [];
    } catch {
      continue;
    }
    const cands = list.map((e) => ({ e, start: e.start, home: e.home.name, away: e.away.name }));
    for (const ev of evs) {
      const m = matchEvent(ev, cands, { toleranceMin: sport === 'tennis' ? 90 : 25 });
      if (m && !m.swapped) out.set(ev.id, m.item.e);
    }
  }
  return out;
}

// Promedios de cada equipo con los datos de Sofascore (teamMatches) y de Flashscore.
export async function addTeamStats(events, details, sources, progress = () => {}) {
  const sofaStats = (list = [], sport) => teamStatsFrom(list.map((m) => ({ home: m.home, stats: sofaMatchStats(m.statistics, sport) })));
  for (const ev of events) {
    const d = details[ev.id];
    if (d?.teamMatches) d.teamStats = { home: sofaStats(d.teamMatches.home, ev.sport), away: sofaStats(d.teamMatches.away, ev.sport) };
  }
  const wanted = events.filter((e) => STAT_SPORTS.has(e.sport) && details[e.id]);
  if (!wanted.length) return new Map();
  progress('Flashscore: partidos de Sofascore', 0.62);
  const found = await findOnFlashscore(wanted);
  let withFs = 0;
  let i = 0;
  for (const ev of wanted) {
    const fs = found.get(ev.id);
    if (!fs) continue;
    progress(`Flashscore: estadísticas de los equipos ${++i} de ${found.size}`, 0.62 + (0.03 * i) / found.size);
    try {
      const r = await ext.call('flashscore', 'getTeamFeeds', { fsId: fs.id, homeId: fs.home.id, awayId: fs.away.id }, { timeout: 120000 });
      const side = (last) => teamStatsFrom(last.filter((m) => r.st?.[m.fsId]).map((m) => ({ home: m.home, stats: parseFsStats(r.st[m.fsId], ev.sport) })));
      const d = details[ev.id];
      const fsStats = { home: side(r.lastHome || []), away: side(r.lastAway || []) };
      d.teamStats = { home: mergeTeamStats(d.teamStats?.home, fsStats.home) || {}, away: mergeTeamStats(d.teamStats?.away, fsStats.away) || {} };
      d.fsId = fs.id;
      withFs++;
    } catch {
      // sin datos de Flashscore para ese partido
    }
  }
  sources.flashscore = { ok: true, matched: withFs, mode: 'extensión' };
  return found;
}

// Estadísticas de Sofascore (reducidas por la extensión) en el formato del registro.
function sofaMatchStats(statistics, sport) {
  return recordFromSofascore({ sport, event: { status: { type: 'finished' } }, statistics })?.stats || null;
}

// Registros de Flashscore de partidos de Sofascore ya terminados (para liquidar
// mercados de estadísticas): Map(id -> registro). legs: [{ eventId, sport, start, match, fsId? }].
export async function flashscoreRecords(legs) {
  const out = new Map();
  const byId = new Map();
  for (const l of legs) if (!byId.has(l.eventId)) byId.set(l.eventId, l);
  const events = [...byId.values()].map((l) => {
    const [home, away] = String(l.match || '').split(' vs ');
    return { id: l.eventId, sport: l.sport, start: l.start, home: { name: home || '' }, away: { name: away || '' } };
  });
  const found = await findOnFlashscore(events.filter((e) => e.home.name && e.away.name));
  for (const [id, fs] of found) {
    if (fs.state !== 'finalizado') continue;
    try {
      const kinds = fs.sport === 'tennis' ? ['st', 'sui', 'mh'] : ['st', 'sui'];
      const f = await ext.call('flashscore', 'getMatchFeeds', { fsId: fs.id, kinds }, { timeout: 60000 });
      out.set(
        id,
        recordFromFlashscore({
          sport: fs.sport,
          state: fs.state,
          final: fs.score ? [fs.score.home, fs.score.away] : null,
          incidents: f.sui ? parseFsIncidents(f.sui, fs.sport) : null,
          stats: f.st ? parseFsStats(f.st, fs.sport) : null,
          games: f.mh ? parseFsGames(f.mh) : null,
        }),
      );
    } catch {
      // se reintenta en la próxima actualización
    }
  }
  return out;
}
