// Extensión simulada para la prueba de punta a punta: se inyecta en la página
// y responde a los mismos pedidos que extension/bridge.js, con datos
// inventados pero con la forma real de cada fuente.
(() => {
  const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const LIMA_MIDNIGHT = Date.parse(`${DAY}T05:00:00Z`);
  const at = (h) => LIMA_MIDNIGHT + h * 3600000;

  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const poisson = (l) => {
    let k = 0;
    let p = Math.exp(-l);
    let s = p;
    const u = rand();
    while (u > s && k < 20) {
      k++;
      p *= l / k;
      s += p;
    }
    return k;
  };

  // [id, sofascore, apuesta total, ataque, defensa]
  const T = (id, name, atName, att, def, extra = {}) => ({ id, name, atName, att, def, ...extra });
  const football = [
    { t: { id: 17, name: 'Premier League', priority: 900 }, c: { name: 'England', alpha2: 'EN' }, games: [
      [T(1, 'Arsenal', 'Arsenal', 2.0, 0.8), T(2, 'Chelsea', 'Chelsea FC', 1.3, 1.2), 13],
      [T(3, 'Manchester United', 'Manchester Utd', 1.2, 1.3), T(4, 'Liverpool', 'Liverpool FC', 2.1, 0.9), 15],
      [T(5, 'Everton', 'Everton', 0.8, 1.4), T(6, 'Tottenham Hotspur', 'Tottenham Hotspur', 1.5, 1.3), 15],
      [T(7, 'Brighton & Hove Albion', 'Brighton', 1.6, 1.1), T(8, 'Leeds United', 'Leeds United', 0.9, 1.6), 17],
    ] },
    { t: { id: 406, name: 'Liga 1', priority: 500 }, c: { name: 'Peru', alpha2: 'PE' }, games: [
      [T(11, 'Universitario', 'Club Universitario de Deportes', 1.9, 0.7), T(12, 'Alianza Lima', 'Club Alianza Lima', 1.5, 0.9), 19],
      [T(13, 'Sporting Cristal', 'Sporting Cristal', 1.8, 0.9), T(14, 'Cienciano', 'Cienciano del Cusco', 1.0, 1.5), 15],
      [T(15, 'Melgar', 'FBC Melgar', 1.4, 1.0), T(16, 'ADT', 'AD Tarma', 0.9, 1.3), 20],
    ] },
  ];
  const basketball = [
    { t: { id: 132, name: 'NBA', priority: 800 }, c: { name: 'USA', alpha2: 'US' }, games: [
      [T(21, 'Los Angeles Lakers', 'LA Lakers', 114, 109), T(22, 'Boston Celtics', 'Boston Celtics', 117, 106), 20],
      [T(23, 'Golden State Warriors', 'Golden State Warriors', 115, 110), T(24, 'Miami Heat', 'Miami Heat', 108, 107), 21],
    ] },
  ];
  const tennis = [
    { t: { id: 2363, name: 'ATP Tokyo', priority: 700 }, c: { name: 'ATP', alpha2: null }, games: [
      [T(31, 'Carlos Alcaraz', 'C. Alcaraz', 0.75, 0, { ranking: 2 }), T(32, 'Tommy Paul', 'T. Paul', 0.6, 0, { ranking: 12 }), 3],
      [T(33, 'Jannik Sinner', 'J. Sinner', 0.8, 0, { ranking: 1 }), T(34, 'Alex de Minaur', 'A. De Minaur', 0.62, 0, { ranking: 8 }), 5],
    ] },
  ];
  const SPORTS = { football, basketball, tennis };
  const teamById = new Map();
  const events = [];
  let nextId = 1000;
  for (const [sport, leagues] of Object.entries(SPORTS)) {
    for (const lg of leagues) {
      for (const [home, away, hour] of lg.games) {
        teamById.set(home.id, { ...home, sport });
        teamById.set(away.id, { ...away, sport });
        events.push({ id: nextId++, sport, lg, home, away, start: at(hour) });
      }
    }
  }
  // Partidos ya jugados o en juego (solo para mostrar).
  const serieA = { t: { id: 23, name: 'Serie A', priority: 850 }, c: { name: 'Italy', alpha2: 'IT' } };
  const shown = [
    { id: 2001, sport: 'football', lg: serieA, home: T(41, 'Inter', 'Inter', 1.8, 0.9), away: T(42, 'Milan', 'AC Milan', 1.6, 1.0), start: at(9), state: 'finalizado', score: [2, 1] },
    { id: 2002, sport: 'football', lg: serieA, home: T(43, 'Juventus', 'Juventus', 1.5, 0.8), away: T(44, 'Roma', 'AS Roma', 1.4, 1.0), start: at(11), state: 'en_vivo', score: [1, 0] },
  ];

  const team = (t) => ({ id: t.id, name: t.name, short: t.name, alpha2: null, ranking: t.ranking ?? null, national: false });
  const toEvent = (e) => ({
    id: e.id,
    sport: e.sport,
    start: e.start,
    tournament: { id: e.lg.t.id, name: e.lg.t.name, priority: e.lg.t.priority },
    category: { id: 1, name: e.lg.c.name, alpha2: e.lg.c.alpha2 },
    home: team(e.home),
    away: team(e.away),
    state: e.state || 'pendiente',
    statusText: '',
    score: e.score ? { home: e.score[0], away: e.score[1], homeNT: e.score[0], awayNT: e.score[1] } : null,
    winner: null,
    url: `https://www.sofascore.com/x-y/abc#id:${e.id}`,
  });

  // Goles/puntos esperados del local y del visitante.
  function expected(e) {
    if (e.sport === 'basketball') return [(e.home.att + e.away.def) / 2 + 2, (e.away.att + e.home.def) / 2 - 2];
    if (e.sport === 'tennis') return null;
    return [((e.home.att + e.away.def) / 2) * 1.1, ((e.away.att + e.home.def) / 2) / 1.1];
  }

  function lastMatches(t, start) {
    const out = [];
    for (let i = 0; i < 12; i++) {
      let gf;
      let ga;
      if (t.sport === 'basketball') {
        gf = Math.round(t.att + (rand() - 0.5) * 20);
        ga = Math.round(t.def + (rand() - 0.5) * 20);
      } else if (t.sport === 'tennis') {
        const win = rand() < t.att;
        gf = win ? 2 : rand() < 0.5 ? 1 : 0;
        ga = win ? (rand() < 0.5 ? 1 : 0) : 2;
      } else {
        gf = poisson(t.att);
        ga = poisson(t.def);
      }
      out.push({ start: start - (i + 1) * 5 * 86400000, home: i % 2 === 0, gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D', opp: 'Rival', league: '' });
    }
    return out;
  }

  // Probabilidades justas para generar cuotas coherentes.
  function fairFootball(e) {
    const [lh, la] = expected(e);
    const pmf = (l) => Array.from({ length: 11 }, (_, k) => (Math.exp(-l) * l ** k) / [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800][k]);
    const ph = pmf(lh);
    const pa = pmf(la);
    let h = 0;
    let d = 0;
    let a = 0;
    const tot = [];
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const p = ph[i] * pa[j];
        if (i > j) h += p;
        else if (i === j) d += p;
        else a += p;
        tot[i + j] = (tot[i + j] || 0) + p;
      }
    const over = (L) => tot.reduce((s, p, k) => (k > L ? s + p : s), 0);
    const btts = (1 - ph[0]) * (1 - pa[0]);
    return { h, d, a, over, btts };
  }
  const odd = (p, margin = 1.06) => Math.max(1.01, Math.round((1 / (p * margin)) * 100) / 100);

  function sofascoreOdds(e) {
    if (e.sport === 'football') {
      const f = fairFootball(e);
      return [
        { name: 'Full time', group: null, live: false, choices: [{ name: '1', price: odd(f.h) }, { name: 'X', price: odd(f.d) }, { name: '2', price: odd(f.a) }] },
        { name: 'Match goals', group: '2.5', live: false, choices: [{ name: 'Over', price: odd(f.over(2.5)) }, { name: 'Under', price: odd(1 - f.over(2.5)) }] },
      ];
    }
    const pHome = e.sport === 'tennis' ? e.home.att / (e.home.att + e.away.att) : 0.5 + (expected(e)[0] - expected(e)[1]) / 30;
    return [{ name: 'Home/Away', group: null, live: false, choices: [{ name: '1', price: odd(pHome) }, { name: '2', price: odd(1 - pHome) }] }];
  }

  function atMarkets(e) {
    const H = e.home.atName;
    const A = e.away.atName;
    if (e.sport === 'football') {
      const f = fairFootball(e);
      const ou = [1.5, 2.5, 3.5].flatMap((L) => [
        { name: `Más de ${L}`, price: odd(f.over(L), 1.05) },
        { name: `Menos de ${L}`, price: odd(1 - f.over(L), 1.05) },
      ]);
      return [
        { name: 'Resultado del partido (1X2)', type: 'ML0', selections: [{ name: 'Empate', price: odd(f.d, 1.05) }, { name: H, price: odd(f.h, 1.05) }, { name: A, price: odd(f.a, 1.05) }] },
        { name: 'Total de goles', type: 'OU200', selections: ou },
        { name: 'Ambos equipos anotan', type: 'QA158', selections: [{ name: 'Sí', price: odd(f.btts, 1.05) }, { name: 'No', price: odd(1 - f.btts, 1.05) }] },
        { name: 'Doble Oportunidad', type: 'QA61', selections: [{ name: `${H} o Empate`, price: odd(f.h + f.d, 1.03) }, { name: `Empate o ${A}`, price: odd(f.d + f.a, 1.03) }, { name: `${H} o ${A}`, price: odd(f.h + f.a, 1.03) }] },
      ];
    }
    if (e.sport === 'basketball') {
      const [h, a] = expected(e);
      const total = Math.floor(h + a) + 0.5;
      return [
        { name: 'Ganador (incl. prórroga)', type: 'ML0', selections: [{ name: H, price: odd(0.5 + (h - a) / 30, 1.05) }, { name: A, price: odd(0.5 - (h - a) / 30, 1.05) }] },
        { name: 'Total de puntos', type: 'OU0', selections: [{ name: `Más de ${total}`, price: 1.9 }, { name: `Menos de ${total}`, price: 1.9 }] },
        { name: 'Hándicap', type: 'HC0', selections: [{ name: `${H} (${-Math.round(h - a) - 0.5})`, price: 1.9 }, { name: `${A} (+${Math.round(h - a) + 0.5})`, price: 1.9 }] },
      ];
    }
    const pHome = e.home.att / (e.home.att + e.away.att);
    return [{ name: 'Ganador del partido', type: 'ML0', selections: [{ name: H, price: odd(pHome, 1.05) }, { name: A, price: odd(1 - pHome, 1.05) }] }];
  }

  function result(e) {
    if (e.sport === 'basketball') {
      const [h, a] = expected(e);
      const sh = Math.round(h + (rand() - 0.5) * 24);
      let sa = Math.round(a + (rand() - 0.5) * 24);
      if (sa === sh) sa++;
      return { home: sh, away: sa };
    }
    if (e.sport === 'tennis') return rand() < e.home.att / (e.home.att + e.away.att) ? { home: 2, away: rand() < 0.5 ? 1 : 0 } : { home: rand() < 0.5 ? 1 : 0, away: 2 };
    const [lh, la] = expected(e);
    const h = poisson(lh);
    const a = poisson(la);
    return { home: h, away: a, homeNT: h, awayNT: a };
  }

  const all = [...events, ...shown];
  const byId = new Map(all.map((e) => [e.id, e]));
  const fixedResults = new Map();
  const files = new Map(); // simulación de GitHub (no se usa: modo navegador)
  window.__BDP_MOCK_LOG__ = [];

  const handlers = {
    'github.status': () => ({ configured: false, repo: 'LuisP11127/Analisis-BDP', branch: 'x' }),
    'github.getFile': ({ path }) => (files.has(path) ? { text: files.get(path), sha: 'x' } : null),
    'sofascore.getSportEvents': ({ sport, date }) => ({
      mode: 'direct',
      items: date === DAY ? all.filter((e) => e.sport === sport).map(toEvent) : [],
    }),
    'sofascore.getEventDetails': ({ events: list }) => {
      const items = {};
      for (const { id } of list) {
        const e = byId.get(id);
        items[id] = {
          form: null,
          h2h: { homeWins: 2, draws: 1, awayWins: 1 },
          missing: { home: [], away: [{ player: 'Jugador X', position: 'F', type: 'missing', reason: 'Lesión' }], confirmed: false },
          odds: sofascoreOdds(e),
          votes: { home: 0.55, draw: 0.2, away: 0.25, total: 1000 },
          lastHome: lastMatches({ ...e.home, sport: e.sport }, e.start),
          lastAway: lastMatches({ ...e.away, sport: e.sport }, e.start),
        };
      }
      return { mode: 'direct', items, failed: 0, requests: list.length * 7 };
    },
    'sofascore.getEventResults': ({ ids }) => {
      const items = {};
      for (const id of ids) {
        const e = byId.get(id);
        if (!e) continue;
        if (!fixedResults.has(id)) fixedResults.set(id, result(e));
        items[id] = { state: 'finalizado', score: fixedResults.get(id), winner: null };
      }
      return { mode: 'direct', items };
    },
    'apuestatotal.getEventList': ({ sport }) => ({
      mode: 'direct',
      items: events.filter((e) => e.sport === sport).map((e) => ({ eventId: `at${e.id}`, start: e.start, league: e.lg.t.name, country: '', home: e.home.atName, away: e.away.atName, live: false })),
    }),
    'apuestatotal.getMarkets': ({ eventIds }) => ({
      items: Object.fromEntries(eventIds.map((id) => [id, atMarkets(byId.get(Number(id.slice(2))))])),
      errors: [],
    }),
    'betano.getOdds': () => {
      throw new Error('No se encontraron cuotas en Betano');
    },
    'understat.getTeamStrength': ({ league }) => ({
      mode: 'direct',
      items:
        league === 'EPL'
          ? football[0].games.flatMap(([h, a]) => [h, a]).map((t) => ({ team: t.name, xgFor: t.att * 0.95, xgAgainst: t.def * 1.05, matches: 6 }))
          : [],
    }),
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.bdp !== 'request') return;
    if (msg.action === 'ping') return window.postMessage({ bdp: 'ready', version: '9.9.9-prueba' }, '*');
    const { source, fn, args } = msg.params || {};
    window.__BDP_MOCK_LOG__.push(`${source}.${fn}`);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const handler = handlers[`${source}.${fn}`];
      if (!handler) throw new Error(`Función no disponible: ${source}.${fn}`);
      window.postMessage({ bdp: 'response', id: msg.id, ok: true, data: handler(args || {}) }, '*');
    } catch (e) {
      window.postMessage({ bdp: 'response', id: msg.id, ok: false, error: e.message }, '*');
    }
  });
  window.postMessage({ bdp: 'ready', version: '9.9.9-prueba' }, '*');
})();
