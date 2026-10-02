// Recolecta los datos que usa la página sin extensión. Corre en GitHub Actions
// cada 2 horas y escribe en <salida>/data/fuente/:
//   indice.json                     cuándo se generó y cuántos partidos hay
//   AAAA-MM-DD/<deporte>.json       partidos de hoy y mañana con últimos
//                                   resultados, H2H, cuotas de Apuesta Total y xG
//   resultados/AAAA-MM-DD.json      marcadores finales (últimos 7 días) para
//                                   liquidar las apuestas
// Uso: node scripts/collect-data.mjs [salida] (por defecto "site")
import fs from 'node:fs/promises';
import path from 'node:path';
import { getH2H, getSportDay, SPORT_IDS } from '../extension/sources/flashscore.js';
import { getEventList, getMarkets } from '../extension/sources/apuestatotal.js';
import { getTeamStrength } from '../extension/sources/understat.js';
import { basicNorm, bestByName, countryCode, matchEvent } from '../docs/js/analysis/matching.js';
import { offersFromApuestaTotal } from '../docs/js/analysis/markets.js';
import { addDays, limaToday } from '../docs/js/util.js';
import { compactDay, compactResult } from '../docs/js/data-format.js';

const OUT = path.resolve(process.argv[2] || 'site', 'data/fuente');
const CACHE = path.resolve('.cache/h2h');
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


async function main() {
  const today = limaToday();
  const started = Date.now();
  const sports = Object.keys(SPORT_IDS);
  const upcoming = {}; // fecha -> deporte -> partidos
  const results = {}; // fecha -> id -> resultado

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
        for (const e of done) (results[date] ||= {})[e.id] = compactResult(e);
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
