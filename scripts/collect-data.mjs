// Recolecta los datos que usa la página sin extensión. Corre en GitHub Actions
// cada 2 horas y escribe en <salida>/data/fuente/:
//   indice.json                     cuándo se generó y cuántos partidos hay
//   AAAA-MM-DD/<deporte>.json       partidos de hoy y mañana con últimos
//                                   resultados, H2H, cuotas de Apuesta Total y xG
//   noticias.json                   noticias de Flashscore, ESPN y FotMob (para la
//                                   red neuronal; se acumulan 3 días en caché)
//   resultados/AAAA-MM-DD.json      marcadores finales y por periodo (últimos 7
//                                   días) para liquidar las apuestas; los partidos
//                                   analizados (docs/data/historial) llevan además
//                                   el registro completo: incidencias (goles con
//                                   minuto, tarjetas) y estadísticas (córners...)
// Uso: node scripts/collect-data.mjs [salida] (por defecto "site")
import fs from 'node:fs/promises';
import path from 'node:path';
import { getH2H, getMatchFeeds, getNews as flashscoreNews, getSportDay, SPORT_IDS } from '../extension/sources/flashscore.js';
import { getAllNews as espnNews } from '../extension/sources/espn.js';
import { getNews as fotmobNews } from '../extension/sources/fotmob.js';
import { compactNews } from '../docs/js/analysis/news.js';
import { getEventList, getMarkets } from '../extension/sources/apuestatotal.js';
import { getTeamStrength } from '../extension/sources/understat.js';
import { basicNorm, bestByName, countryCode, matchEvent } from '../docs/js/analysis/matching.js';
import { offersFromApuestaTotal } from '../docs/js/analysis/markets.js';
import { addDays, limaToday } from '../docs/js/util.js';
import { compactDay, compactResult } from '../docs/js/data-format.js';
import { parseFsGames, parseFsIncidents, parseFsStats, periodsFromRow, recordFromFlashscore } from '../docs/js/analysis/records.js';
import { teamStatsFrom } from '../docs/js/analysis/teamstats.js';

const OUT = path.resolve(process.argv[2] || 'site', 'data/fuente');
const CACHE = path.resolve('.cache/h2h-v3'); // subir la versión si cambia getH2H
const DETAIL_CACHE = path.resolve('.cache/detalle-v1'); // feeds de partidos terminados (no cambian)
const HISTORY = path.resolve('docs/data/historial');
// Deportes con estadísticas por partido en Flashscore (para los mercados de estadísticas).
const STAT_SPORTS = new Set(['football', 'basketball', 'ice-hockey', 'tennis', 'baseball', 'american-football', 'handball', 'rugby']);
const TEAM_MATCHES = 8; // últimos partidos de cada equipo para sus estadísticas
const MAX_DETAIL_FETCHES = 6000; // por corrida (el resto queda para la siguiente; los feeds quedan en caché)
const DETAIL_BUDGET_MS = 6 * 60000; // tiempo máximo para pedir feeds de detalle (la página se publica igual)
const CACHE_HOURS = 12;
const AHEAD = [0, 1];
const BACK = [-7, -6, -5, -4, -3, -2, -1];
const UNDERSTAT = {
  'inglaterra|premier league': 'EPL',
  'espana|laliga': 'La_liga',
  'alemania|bundesliga': 'Bundesliga',
  'italia|serie a': 'Serie_A',
  'francia|ligue 1': 'Ligue_1',
};

const log = (...a) => console.log(...a);

async function pool(items, worker, concurrency = 6) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
}

// H2H con caché (no cambia mucho en el día).
async function h2hCached(ev) {
  const fsId = ev.id.slice(3);
  const file = path.join(CACHE, `${fsId}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Date.now() - cached.at < CACHE_HOURS * 3600000) return cached.data;
  } catch {
    // sin caché
  }
  const data = await getH2H({ fsId, homeId: ev.home.id, awayId: ev.away.id });
  await writeJson(file, { at: Date.now(), data });
  return data;
}


// Feeds de detalle de un partido terminado, con caché permanente.
let fetches = 0;
let detailStart = 0; // cuándo empezó a pedir feeds de detalle
const detailTimeLeft = () => !detailStart || Date.now() - detailStart < DETAIL_BUDGET_MS;
async function feedsCached(fsId, kinds) {
  const id = String(fsId).replace(/^fs:/, '');
  const file = path.join(DETAIL_CACHE, `${id}.json`);
  let cached = {};
  try {
    cached = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    // sin caché
  }
  const missing = kinds.filter((k) => typeof cached[k] !== 'string');
  if (missing.length && fetches < MAX_DETAIL_FETCHES && detailTimeLeft()) {
    detailStart ||= Date.now();
    fetches += missing.length;
    const got = await getMatchFeeds({ fsId: id, kinds: missing });
    for (const k of missing) if (typeof got[k] === 'string') cached[k] = got[k];
    cached.at = Date.now();
    await writeJson(file, cached);
  }
  return cached;
}

// Partidos analizados en los últimos días (del historial del repositorio):
// id -> { sport, start, home, away }.
async function analyzedEvents(days) {
  const out = new Map();
  for (const date of days) {
    let day;
    try {
      day = JSON.parse(await fs.readFile(path.join(HISTORY, `${date}.json`), 'utf8'));
    } catch {
      continue;
    }
    for (const a of day.analyses || []) {
      for (const [id, e] of Object.entries(a.events || {})) {
        if (!out.has(id) && e?.home && e?.away) out.set(id, { id, sport: e.sport, start: e.start, home: e.home, away: e.away });
      }
      for (const leg of [...(a.picks || []), ...(a.combos || []).flatMap((k) => k.legs || [])]) {
        if (out.has(String(leg.eventId)) || !leg.match) continue;
        const [home, away] = leg.match.split(' vs ');
        if (home && away) out.set(String(leg.eventId), { id: String(leg.eventId), sport: leg.sport, start: leg.start, home, away });
      }
    }
  }
  return out;
}

// Borra de la caché los feeds de más de 30 días.
async function pruneCache(dir, days = 30) {
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  const limit = Date.now() - days * 86400000;
  for (const f of files) {
    const file = path.join(dir, f);
    const st = await fs.stat(file).catch(() => null);
    if (st && st.mtimeMs < limit) await fs.rm(file, { force: true });
  }
}

async function main() {
  const today = limaToday();
  await pruneCache(DETAIL_CACHE);
  const started = Date.now();
  const sports = Object.keys(SPORT_IDS);
  const upcoming = {}; // fecha -> deporte -> partidos
  const results = {}; // fecha -> id -> resultado
  const finished = {}; // fecha -> partidos terminados (para los registros)

  // 1) Partidos y resultados de Flashscore.
  await pool(
    sports.flatMap((sport) => [...BACK, ...AHEAD].map((day) => ({ sport, day }))),
    async ({ sport, day }) => {
      const date = addDays(today, day);
      try {
        const { items } = await getSportDay({ sport, day });
        for (const e of items) e.category.alpha2 = countryCode(e.category.name);
        if (day >= 0) (upcoming[date] ||= {})[sport] = items;
        const done = items.filter((e) => ['finalizado', 'aplazado', 'cancelado'].includes(e.state));
        for (const e of done) {
          (results[date] ||= {})[e.id] = compactResult(e, { per: e.fsRow ? periodsFromRow(e.fsRow, sport) : null });
          (finished[date] ||= []).push(e);
        }
      } catch (e) {
        log(`Flashscore ${sport} día ${day}: ${e.message}`);
      }
    },
  );

  // 2) Cuotas de Apuesta Total emparejadas con cada partido.
  const offers = {}; // id -> ofertas
  const leagueOrder = {}; // liga -> orden en Apuesta Total (menor = más importante)
  const now = Date.now();
  for (const sport of sports) {
    const events = AHEAD.flatMap((d) => upcoming[addDays(today, d)]?.[sport] || []).filter((e) => e.state === 'pendiente');
    if (!events.length) continue;
    try {
      const { items: list } = await getEventList({ sport, from: now - 3 * 3600000, to: now + 54 * 3600000 });
      const pairs = new Map();
      for (const ev of events) {
        const m = matchEvent(ev, list, { toleranceMin: sport === 'tennis' ? 90 : 25 });
        if (m && !pairs.has(m.item.eventId)) pairs.set(m.item.eventId, { ev, m });
      }
      if (!pairs.size) continue;
      const { items: markets, errors } = await getMarkets({ eventIds: [...pairs.keys()], sport });
      if (errors.length) log(`Apuesta Total ${sport}: ${errors.length} errores de mercados`);
      for (const [atId, { ev, m }] of pairs) {
        const list2 = offersFromApuestaTotal(markets[atId] || [], m.item, ev, m.swapped);
        if (!list2.length) continue;
        offers[ev.id] = list2;
        const key = `${sport}|${ev.tournament.id}`;
        leagueOrder[key] = Math.min(leagueOrder[key] ?? Infinity, m.item.leagueOrder ?? 9e9);
      }
      log(`Apuesta Total ${sport}: ${list.length} eventos, ${pairs.size} emparejados`);
    } catch (e) {
      log(`Apuesta Total ${sport}: ${e.message}`);
    }
  }

  // Importancia de cada liga: las que tienen cuotas primero, en el orden de Apuesta Total.
  const ranked = Object.entries(leagueOrder).sort((a, b) => a[1] - b[1]);
  const priority = Object.fromEntries(ranked.map(([key], i) => [key, 1000 - i]));

  // 3) Últimos partidos y H2H de los partidos con cuotas.
  const details = {};
  const withOdds = Object.values(upcoming)
    .flatMap((bySport) => Object.values(bySport).flat())
    .filter((e) => offers[e.id]);
  let h2hErrors = 0;
  await pool(withOdds, async (ev) => {
    try {
      details[ev.id] = await h2hCached(ev);
    } catch {
      h2hErrors++;
    }
  });
  log(`H2H: ${Object.keys(details).length} partidos (${h2hErrors} errores)`);

  // 3b) Estadísticas de cada equipo en sus últimos partidos (córners,
  //     tarjetas, tiros, rebotes, aces...): df_st de cada partido, con caché.
  let withTeamStats = 0;
  await pool(
    // Primero los partidos más próximos.
    withOdds.filter((ev) => details[ev.id] && STAT_SPORTS.has(ev.sport)).sort((a, b) => a.start - b.start),
    async (ev) => {
      const d = details[ev.id];
      const side = async (last) => {
        const matches = [];
        for (const m of (last || []).filter((x) => x.fsId).slice(0, TEAM_MATCHES)) {
          try {
            const { st } = await feedsCached(m.fsId, ['st']);
            if (st) matches.push({ home: m.home, stats: parseFsStats(st, ev.sport) });
          } catch {
            // partido sin estadísticas
          }
        }
        return teamStatsFrom(matches);
      };
      const home = await side(d.lastHome);
      const away = await side(d.lastAway);
      if (Object.keys(home).length && Object.keys(away).length) {
        d.teamStats = { home, away };
        withTeamStats++;
      }
    },
    8,
  );
  log(`Estadísticas de equipo: ${withTeamStats} partidos (${fetches} feeds nuevos)`);

  // 4) xG de Understat (fútbol, 5 grandes ligas).
  const xg = {};
  const byLeague = new Map();
  for (const ev of withOdds.filter((e) => e.sport === 'football')) {
    const league = UNDERSTAT[`${basicNorm(ev.category.name)}|${basicNorm(ev.tournament.name)}`];
    if (league) (byLeague.get(league) || byLeague.set(league, []).get(league)).push(ev);
  }
  for (const [league, evs] of byLeague) {
    try {
      const { items } = await getTeamStrength({ league });
      for (const ev of evs) {
        const home = bestByName(ev.home.name, items);
        const away = bestByName(ev.away.name, items);
        if (home && away) xg[ev.id] = { home, away };
      }
    } catch (e) {
      log(`Understat ${league}: ${e.message}`);
    }
  }

  // 4b) Registro completo (incidencias y estadísticas) de los partidos
  //     analizados que ya terminaron. Los de Sofascore se cruzan por nombre.
  const analyzed = await analyzedEvents(BACK.concat(AHEAD).map((d) => addDays(today, d)));
  detailStart = 0; // los registros (para liquidar) tienen su propio tiempo
  const wanted = [];
  for (const [date, list] of Object.entries(finished)) {
    const bySport = new Map();
    for (const e of list) (bySport.get(e.sport) || bySport.set(e.sport, []).get(e.sport)).push(e);
    for (const a of analyzed.values()) {
      const fsEv = a.id.startsWith('fs:') ? list.find((e) => e.id === a.id) : null;
      if (fsEv) {
        wanted.push({ key: a.id, date, ev: fsEv });
        continue;
      }
      if (a.id.startsWith('fs:') || !Number.isFinite(a.start)) continue;
      if (Math.abs(a.start - Date.parse(`${date}T12:00:00-05:00`)) > 36 * 3600000) continue;
      const cands = (bySport.get(a.sport) || []).map((e) => ({ e, start: e.start, home: e.home.name, away: e.away.name }));
      const m = matchEvent({ start: a.start, home: { name: a.home }, away: { name: a.away } }, cands, { toleranceMin: a.sport === 'tennis' ? 90 : 25 });
      if (m && !m.swapped) wanted.push({ key: a.id, date, ev: m.item.e });
    }
  }
  let records = 0;
  await pool(
    wanted.filter((w) => w.ev.state === 'finalizado'),
    async ({ key, date, ev }) => {
      try {
        const kinds = ev.sport === 'tennis' ? ['st', 'sui', 'mh'] : ['st', 'sui'];
        const f = await feedsCached(ev.id, kinds);
        if (f.sui == null && f.st == null) return;
        const record = recordFromFlashscore({
          sport: ev.sport,
          state: ev.state,
          final: ev.score ? [ev.score.home, ev.score.away] : null,
          per: ev.fsRow ? periodsFromRow(ev.fsRow, ev.sport) : null,
          incidents: f.sui ? parseFsIncidents(f.sui, ev.sport) : null,
          stats: f.st ? parseFsStats(f.st, ev.sport) : null,
          games: f.mh ? parseFsGames(f.mh) : null,
        });
        (results[date] ||= {})[key] = compactResult(ev, { per: record.per || null, record });
        records++;
      } catch (e) {
        log(`Registro ${key}: ${e.message}`);
      }
    },
    8,
  );
  log(`Registros completos: ${records} de ${analyzed.size} partidos analizados`);

  // 4c) Noticias (solo para la red neuronal): se acumulan 3 días en caché.
  const newsFile = path.resolve('.cache/noticias.json');
  let news = [];
  try {
    news = JSON.parse(await fs.readFile(newsFile, 'utf8'));
  } catch {
    // sin caché
  }
  for (const [name, fn] of [
    ['Flashscore', flashscoreNews],
    ['ESPN', espnNews],
    ['FotMob', fotmobNews],
  ]) {
    try {
      const { items } = await fn();
      news.push(...items.map(compactNews));
      log(`Noticias ${name}: ${items.length}`);
    } catch (e) {
      log(`Noticias ${name}: ${e.message}`);
    }
  }
  const seenNews = new Set();
  const since = Date.now() / 1000 - 3 * 86400;
  news = news
    .filter((n) => n[1] && (n[3] == null || n[3] >= since) && !seenNews.has(n[1]) && seenNews.add(n[1]))
    .sort((a, b) => (b[3] || 0) - (a[3] || 0))
    .slice(0, 1500);
  await writeJson(newsFile, news);

  // 5) Archivos.
  const index = { generated: new Date().toISOString(), today, days: {} };
  for (const [date, bySport] of Object.entries(upcoming)) {
    index.days[date] = {};
    for (const [sport, events] of Object.entries(bySport)) {
      for (const e of events) e.tournament.priority = priority[`${sport}|${e.tournament.id}`] || 0;
      const ids = new Set(events.map((e) => e.id));
      const pick = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => ids.has(id)));
      await writeJson(
        path.join(OUT, date, `${sport}.json`),
        compactDay({ date, sport, generated: index.generated, events, offers: pick(offers), details: pick(details), xg: pick(xg) }),
      );
      index.days[date][sport] = { events: events.length, withOdds: events.filter((e) => offers[e.id]).length };
    }
  }
  for (const [date, map] of Object.entries(results)) await writeJson(path.join(OUT, 'resultados', `${date}.json`), map);
  await writeJson(path.join(OUT, 'noticias.json'), { generated: index.generated, items: news });
  await writeJson(path.join(OUT, 'indice.json'), index);

  const total = (d) => Object.values(index.days[d] || {}).reduce((s, x) => s + x.events, 0);
  const odds = (d) => Object.values(index.days[d] || {}).reduce((s, x) => s + x.withOdds, 0);
  log(`Listo en ${((Date.now() - started) / 1000).toFixed(0)} s · hoy ${total(today)} partidos (${odds(today)} con cuotas) · mañana ${total(addDays(today, 1))} (${odds(addDays(today, 1))} con cuotas) · xG ${Object.keys(xg).length}`);
  for (const [sport, s] of Object.entries(index.days[today] || {})) log(`  ${sport}: ${s.events} partidos, ${s.withOdds} con cuotas`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
