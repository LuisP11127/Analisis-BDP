// Registro de un partido terminado (el formato de outcomes.js) a partir de los
// datos de Flashscore (periodos, incidencias y estadísticas) y de Sofascore
// (marcador por periodo, incidencias y estadísticas). Con el registro se
// liquidan todos los mercados: mitades, cuartos, sets, córners, tarjetas,
// primer gol, minuto del gol, etc.
import { clean, SET_SPORTS } from './catalog.js';

// ---- Flashscore ----

// Feed de Flashscore conservando la primera aparición de cada campo (en las
// incidencias "IK" se repite: gol y asistencia).
export function parseFeedFirst(text = '') {
  return String(text)
    .split('~')
    .filter(Boolean)
    .map((record) => {
      const fields = {};
      for (const part of record.split('¬')) {
        const i = part.indexOf('÷');
        if (i > 0 && !(part.slice(0, i) in fields)) fields[part.slice(0, i)] = part.slice(i + 1);
      }
      return fields;
    });
}

// "1er Tiempo" → h1, "2º Cuarto" → p2, "3er Set" → s3, "1a Entrada" / "2" → i1 / i2, "Partido" → ft.
export function scopeOfLabel(label, sport) {
  const t = clean(label);
  if (!t || t === 'partido') return 'ft';
  if (/prorroga|tiempo extra|overtime|penaltis|penales|shootout|entradas extra/.test(t)) return 'ot';
  const n = Number((t.match(/(\d+)/) || [])[1]);
  if (/tiempo|mitad/.test(t)) return n === 2 ? 'h2' : 'h1';
  if (/cuarto|periodo/.test(t)) return `p${n || 1}`;
  if (/set|juego|mapa/.test(t)) return `s${n || 1}`;
  if (/entrada|inning/.test(t) || (sport === 'baseball' && /^\d+$/.test(t))) return `i${n || 1}`;
  if (/^\d+$/.test(t)) return SET_SPORTS.has(sport) ? `s${n}` : `p${n}`;
  return null;
}

// Nombre de la estadística de Flashscore → código del catálogo. `pick`: qué
// número usar de "58% (136/233)" (total, ok) o de "6/15".
const FS_STATS = [
  [/^goles esperados \(xg\)$/, 'xg'],
  [/^posesion$/, 'possession'],
  [/^remates totales$/, 'shots'],
  [/^remates a puerta$/, 'shots_on'],
  [/^remates fuera$/, 'shots_off'],
  [/^corneres$/, 'corners'],
  [/^tarjetas amarillas$/, 'yellows'],
  [/^tarjetas rojas$/, 'reds'],
  [/^fueras de juego$/, 'offsides'],
  [/^saques de banda$/, 'throwins'],
  [/^saques de puerta$/, 'goalkicks'],
  [/^faltas$/, 'fouls'],
  [/^pases$/, 'passes', 'total'],
  [/^entradas$/, 'tackles', 'total'],
  [/^al palo$/, 'woodwork'],
  [/^paradas( portero)?$/, 'saves'],
  [/^tiros a puerta$/, 'sog'],
  [/^min\.? penalizacion$/, 'pim'],
  [/^goles powerplay$/, 'ppg'],
  [/^goles inferioridad$/, 'shg'],
  [/^goles puerta vacia$/, 'eng'],
  [/^tiros de 3 anotados$/, 'threes'],
  [/^tiros de 2 anotados$/, 'twos'],
  [/^tiros libres anotados$/, 'ftm'],
  [/^rebotes ofensivos$/, 'oreb'],
  [/^rebotes defensivos$/, 'dreb'],
  [/^rebotes totales$/, 'reb'],
  [/^asistencias$/, 'ast'],
  [/^perdidas$/, 'tov'],
  [/^aces$/, 'aces'],
  [/^dobles faltas$/, 'df'],
  [/^puntos break convertidos$/, 'breaks', 'ok'],
  [/^puntos ganados servicio$/, 'serve_pts', 'pair'],
  [/^puntos ganados resto$/, 'return_pts', 'pair'],
  [/^juegos ganados servicio$/, 'holds', 'pair'],
  [/^hits$/, 'hits'],
  [/^errores$/, 'errors'],
  [/^home runs$/, 'hr'],
  [/^touchdowns$/, 'tds'],
  [/^touchdowns por acarreo$/, 'rush_tds'],
  [/^touchdowns pasando$/, 'pass_tds'],
  [/^yardas por aire$/, 'pass_yds'],
  [/^yardas por tierra$/, 'rush_yds'],
  [/^yardas totales$/, 'total_yds'],
  [/^field goals convertidos$/, 'fgs'],
  [/^ensayos$/, 'tries'],
  [/^180 ?s?$|^180 lanzados$/, '180s'],
];

function statValue(raw, pick) {
  const s = String(raw ?? '').trim();
  const frac = s.match(/\((\d+)\/(\d+)\)/) || s.match(/^(\d+)\/(\d+)$/);
  if (pick === 'pair') return frac ? [Number(frac[1]), Number(frac[2])] : null;
  if (frac) return Number(pick === 'total' ? frac[2] : frac[1]);
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

// df_st_1_<id> → { corners: { ft: [6, 3], h1: [...] }, ... }
export function parseFsStats(text, sport) {
  const stats = {};
  let scope = 'ft';
  for (const r of parseFeedFirst(text)) {
    if (r.SE !== undefined) scope = scopeOfLabel(r.SE, sport);
    if (r.SG === undefined || !scope) continue;
    const name = clean(r.SG);
    const def = FS_STATS.find(([re]) => re.test(name));
    if (!def) continue;
    const [, code, pick] = def;
    const h = statValue(r.SH, pick);
    const a = statValue(r.SI, pick);
    if (h == null || a == null) continue;
    ((stats[code] ||= {})[scope] ||= [h, a]);
  }
  // Tarjetas: amarillas + rojas (cada tarjeta cuenta 1).
  if (stats.yellows) {
    stats.cards = {};
    for (const [sc, y] of Object.entries(stats.yellows)) {
      const r = stats.reds?.[sc] || [0, 0];
      stats.cards[sc] = [y[0] + r[0], y[1] + r[1]];
    }
  }
  // Si falta el partido completo pero están las mitades, se suman.
  for (const s of Object.values(stats)) {
    if (!s.ft && s.h1 && s.h2 && typeof s.h1[0] === 'number') s.ft = [s.h1[0] + s.h2[0], s.h1[1] + s.h2[1]];
  }
  return stats;
}

// "21'" → 20.5 (minuto 21 = de 20:00 a 20:59), "45+2'" → 44.99, "12:29" → 12.48.
export function minuteOf(text, { perIndex = 0, perMinutes = 0 } = {}) {
  const t = String(text || '').trim();
  const plus = t.match(/^(\d+)\+(\d+)'?$/);
  if (plus) return Number(plus[1]) - 0.01;
  const clock = t.match(/^(\d+):(\d+)$/);
  if (clock) {
    let m = Number(clock[1]) + Number(clock[2]) / 60;
    // En hockey el reloj puede ser del periodo: se suma lo jugado antes.
    if (perMinutes && perIndex > 0 && m < perIndex * perMinutes) m += perIndex * perMinutes;
    return m;
  }
  const m = t.match(/^(\d+)'?$/);
  return m ? Math.max(0, Number(m[1]) - 0.5) : null;
}

const PERIOD_MINUTES = { 'ice-hockey': 20, floorball: 20, football: 45, futsal: 20, handball: 30, waterpolo: 8, basketball: 10, 'american-football': 15, rugby: 40 };

// df_sui_1_<id> → { per, events, stats (ppg/shg/pim), duration }
export function parseFsIncidents(text, sport) {
  const per = [];
  const labels = [];
  const events = [];
  const duration = {};
  const extra = {};
  let perIndex = -1;
  const add = (code, side, n = 1) => {
    const s = ((extra[code] ||= {}).ft ||= [0, 0]);
    s[side] += n;
  };
  for (const r of parseFeedFirst(text)) {
    if (r.AC !== undefined) {
      perIndex++;
      labels.push(r.AC);
      per.push([r.IG === 'X' ? 'X' : Number(r.IG), r.IH === 'X' ? 'X' : Number(r.IH)]);
      const set = ['RC', 'RD', 'RE', 'RF', 'RG'].find((k) => r[k] !== undefined);
      if (set) duration[`s${perIndex + 1}`] = hoursToMin(r[set]);
      continue;
    }
    if (r.RB !== undefined) duration.ft = hoursToMin(r.RB);
    if (r.III === undefined || !r.IK) continue;
    const team = r.IA === '1' ? 'home' : r.IA === '2' ? 'away' : null;
    if (!team) continue;
    const side = team === 'home' ? 0 : 1;
    const min = minuteOf(r.IB, { perIndex, perMinutes: PERIOD_MINUTES[sport] && sport !== 'football' ? PERIOD_MINUTES[sport] : 0 });
    const kind = clean(r.IK);
    const sub = clean(r.IL || '');
    let k = null;
    if (/^gol en propia/.test(kind)) k = 'og';
    else if (/^penalti fallado|^penal fallado/.test(kind)) k = 'pen';
    else if (/^(gol|touchdown|field goal|punto extra|safety|conversion|ensayo)/.test(kind)) k = /penal/.test(sub) || /penal/.test(kind) ? 'pengoal' : 'goal';
    else if (/^tarjeta roja|^tarjeta amarilla\/roja|segunda amarilla/.test(kind)) k = 'red';
    else if (/^tarjeta amarilla/.test(kind)) k = 'card';
    else if (/^penalizacion/.test(kind)) {
      const m = kind.match(/(\d+)\s*min/);
      if (m) add('pim', side, Number(m[1]));
    }
    if (!k) continue;
    if (k === 'goal' && /superioridad/.test(sub)) add('ppg', side);
    if (k === 'goal' && /inferioridad/.test(sub)) add('shg', side);
    if (k === 'goal' && /puerta vacia/.test(sub)) add('eng', side);
    events.push({ k, team, min, per: Math.max(0, perIndex) });
  }
  return { per, labels, events, stats: extra, duration };
}

const hoursToMin = (t) => {
  const m = String(t || '').match(/^(\d+):(\d+)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// df_mh_1_<id> (tenis): juego a juego, quién sacó y quién ganó.
export function parseFsGames(text) {
  const games = [];
  let set = -1;
  let prev = [0, 0];
  for (const r of parseFeedFirst(text)) {
    if (r.HA !== undefined) {
      set++;
      prev = [0, 0];
      continue;
    }
    if (r.HC === undefined || r.HE === undefined || set < 0) continue;
    const cur = [Number(r.HC), Number(r.HE)];
    const w = cur[0] > prev[0] ? 'home' : cur[1] > prev[1] ? 'away' : null;
    prev = cur;
    if (!w) continue;
    const srv = r.HG === '1' ? 'home' : r.HG === '2' ? 'away' : null;
    games.push({ s: set, w, srv });
  }
  return games;
}

// Periodos de la fila del feed del día (BA/BB, BC/BD...). En fútbol el feed
// a veces omite el 1.er tiempo: se deduce del final y del 2.º tiempo.
const PER_KEYS = ['BA', 'BC', 'BE', 'BG', 'BI', 'BK', 'BM', 'BO', 'BQ'];
export function periodsFromRow(r, sport) {
  const per = [];
  for (const k of PER_KEYS) {
    const k2 = String.fromCharCode(k.charCodeAt(0), k.charCodeAt(1) + 1);
    if (r[k] === undefined && r[k2] === undefined) {
      per.push(null);
      continue;
    }
    per.push([r[k] === 'X' ? 'X' : Number(r[k] ?? 0), r[k2] === 'X' ? 'X' : Number(r[k2] ?? 0)]);
  }
  while (per.length && per[per.length - 1] == null) per.pop();
  if (sport === 'football' && per[0] == null && per[1] && r.AG !== undefined && r.AH !== undefined) {
    per[0] = [Number(r.AG) - per[1][0], Number(r.AH) - per[1][1]];
    if (per[0][0] < 0 || per[0][1] < 0) return null;
  }
  return per.length && per.every(Boolean) ? per : null;
}

// Cantidad de periodos reglamentarios de cada deporte.
const N_REG = { football: 2, futsal: 2, handball: 2, rugby: 2, 'ice-hockey': 3, floorball: 3, bandy: 2, basketball: 4, 'american-football': 4, waterpolo: 4, 'aussie-rules': 4, baseball: 9 };

// Registro a partir de lo que haya de Flashscore. row: { state, score, per? }
export function recordFromFlashscore({ sport, state, final, per, incidents, stats, games, winner }) {
  const rec = { sport, state, final: final || null };
  const inc = incidents || null;
  const periods = inc?.per?.length ? inc.per : per || null;
  if (periods) {
    rec.per = periods.map((p) => [p[0], p[1]]);
    if (!SET_SPORTS.has(sport)) {
      const nReg = N_REG[sport];
      if (nReg) {
        rec.nReg = Math.min(nReg, rec.per.length);
        if (sport === 'baseball') rec.nReg = 9;
        rec.ot = rec.per.length > nReg;
        // Etiquetas de prórroga/penales en las incidencias.
        if (inc?.labels?.length) rec.ot = inc.labels.some((l) => scopeOfLabel(l, sport) === 'ot');
      }
    }
  }
  if (inc?.events?.length) rec.events = inc.events.slice().sort((a, b) => a.min - b.min);
  const st = { ...(stats || {}) };
  for (const [code, v] of Object.entries(inc?.stats || {})) if (!st[code]) st[code] = v;
  if (Object.keys(st).length) rec.stats = st;
  if (games?.length) rec.games = games;
  if (inc?.duration && Object.keys(inc.duration).length) rec.duration = inc.duration;
  if (winner) rec.winner = winner;
  return rec;
}

// ---- Sofascore ----

// event: /event/{id} (homeScore.period1...), statistics: /event/{id}/statistics,
// incidents: /event/{id}/incidents.
const SOFA_STATUS = { finished: 'finalizado', postponed: 'aplazado', canceled: 'cancelado', inprogress: 'en_vivo', notstarted: 'pendiente' };
const SOFA_PERIOD = { ALL: 'ft', '1ST': 'h1', '2ND': 'h2', '1Q': 'p1', '2Q': 'p2', '3Q': 'p3', '4Q': 'p4', '1P': 'p1', '2P': 'p2', '3P': 'p3', '1SET': 's1', '2SET': 's2', '3SET': 's3', '4SET': 's4', '5SET': 's5' };
const SOFA_STATS = {
  cornerKicks: 'corners',
  yellowCards: 'yellows',
  redCards: 'reds',
  totalShotsOnGoal: 'shots',
  shotsOnGoal: 'shots_on',
  fouls: 'fouls',
  offsides: 'offsides',
  throwIns: 'throwins',
  goalKicks: 'goalkicks',
  hitWoodwork: 'woodwork',
  expectedGoals: 'xg',
  goalkeeperSaves: 'saves',
  passes: 'passes',
  totalTackle: 'tackles',
  aces: 'aces',
  doubleFaults: 'df',
  breakPointsScored: 'breaks',
  threePointsScored: 'threes',
  twoPointsScored: 'twos',
  freeThrowsScored: 'ftm',
  offensiveRebounds: 'oreb',
  defensiveRebounds: 'dreb',
  rebounds: 'reb',
  assists: 'ast',
  turnovers: 'tov',
  shotsOnGoalHockey: 'sog',
  penaltyMinutes: 'pim',
  powerPlayGoals: 'ppg',
  shortHandedGoals: 'shg',
  hits: 'hits',
  errors: 'errors',
  homeRuns: 'hr',
};

export function recordFromSofascore({ sport, event, statistics, incidents }) {
  if (!event) return null;
  const type = event.status?.type;
  const rec = { sport, state: SOFA_STATUS[type] || 'otro' };
  const hs = event.homeScore || {};
  const as = event.awayScore || {};
  const per = [];
  for (let i = 1; i <= 9; i++) {
    if (hs[`period${i}`] == null && as[`period${i}`] == null) break;
    per.push([hs[`period${i}`] ?? 0, as[`period${i}`] ?? 0]);
  }
  const reg = hs.normaltime != null && as.normaltime != null ? [hs.normaltime, as.normaltime] : null;
  if (SET_SPORTS.has(sport)) {
    if (per.length) rec.per = per;
    if (hs.current != null) rec.final = [hs.current, as.current];
  } else {
    if (per.length) {
      const nReg = N_REG[sport] || per.length;
      rec.per = per.slice(0, nReg);
      rec.nReg = rec.per.length;
      if (hs.overtime != null || as.overtime != null) {
        rec.per.push([hs.overtime ?? 0, as.overtime ?? 0]);
        rec.ot = true;
      } else rec.ot = per.length > nReg;
      if (per.length > nReg && hs.overtime == null) rec.per.push(...per.slice(nReg));
    }
    if (hs.current != null) rec.final = [hs.current, as.current];
    if (reg && (sport === 'football' || sport === 'futsal') && !rec.per) rec.final = reg;
  }
  if (event.winnerCode === 1 || event.winnerCode === 2) rec.winner = event.winnerCode;

  const stats = {};
  for (const block of statistics?.statistics || []) {
    const scope = SOFA_PERIOD[block.period];
    if (!scope) continue;
    for (const g of block.groups || []) {
      for (const it of g.statisticsItems || []) {
        const code = SOFA_STATS[it.key] || (it.key === 'shotsOnGoal' && sport === 'ice-hockey' ? 'sog' : null);
        if (!code) continue;
        const h = Number(it.homeTotal ?? it.homeValue);
        const a = Number(it.awayTotal ?? it.awayValue);
        if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
        ((stats[code] ||= {})[scope] ||= [h, a]);
      }
    }
  }
  if (stats.yellows) {
    stats.cards = {};
    for (const [sc, y] of Object.entries(stats.yellows)) {
      const r = stats.reds?.[sc] || [0, 0];
      stats.cards[sc] = [y[0] + r[0], y[1] + r[1]];
    }
  }
  if (Object.keys(stats).length) rec.stats = stats;

  const events = [];
  for (const it of incidents?.incidents || []) {
    const team = it.isHome === true ? 'home' : it.isHome === false ? 'away' : null;
    if (!team || it.time == null) continue;
    const min = Math.max(0, Number(it.time) - 0.5) + (it.addedTime ? 0.49 : 0);
    const cls = String(it.incidentClass || '');
    let k = null;
    if (it.incidentType === 'goal') k = cls === 'ownGoal' ? 'og' : cls === 'penalty' ? 'pengoal' : 'goal';
    else if (it.incidentType === 'card') k = cls === 'yellow' ? 'card' : 'red';
    else if (it.incidentType === 'inGamePenalty' && /miss/i.test(cls)) k = 'pen';
    if (!k) continue;
    // En Sofascore el autogol lleva el equipo del jugador: se cuenta para el rival.
    const t = k === 'og' ? (team === 'home' ? 'away' : 'home') : team;
    events.push({ k, team: t, min: it.addedTime ? Math.min(min, Number(it.time) - 0.01) : min });
  }
  if (events.length) rec.events = events.sort((a, b) => a.min - b.min);
  return rec;
}

// ---- Juntar Sofascore y Flashscore ----

// Combina dos registros del mismo partido: marcador de quien lo tenga y la
// unión de estadísticas (si ambos tienen una, vale la primera).
export function mergeRecords(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = { ...b, ...a };
  for (const k of ['per', 'final', 'events', 'games', 'duration', 'nReg']) if (out[k] == null) out[k] = b[k] ?? a[k];
  if (a.stats || b.stats) {
    out.stats = { ...(b.stats || {}) };
    for (const [code, v] of Object.entries(a.stats || {})) out.stats[code] = { ...(out.stats[code] || {}), ...v };
  }
  if (a.state !== 'finalizado' && b.state === 'finalizado') out.state = 'finalizado';
  return out;
}

// ---- Formato compacto para publicar ----

const KINDS = ['goal', 'pengoal', 'og', 'pen', 'card', 'red'];
export function compactRecord(rec) {
  if (!rec) return null;
  const out = {};
  if (rec.per) out.p = rec.per;
  if (rec.nReg) out.n = rec.nReg;
  if (rec.ot) out.o = 1;
  if (rec.final) out.f = rec.final;
  if (rec.winner) out.w = rec.winner;
  if (rec.events?.length) out.e = rec.events.map((e) => [KINDS.indexOf(e.k), e.team === 'home' ? 0 : 1, Math.round(e.min * 100) / 100]);
  if (rec.stats) out.s = rec.stats;
  if (rec.games?.length) out.g = rec.games.map((x) => `${x.s}${x.w === 'home' ? 1 : 2}${x.srv === 'home' ? 1 : x.srv === 'away' ? 2 : 0}`).join(',');
  if (rec.duration) out.d = rec.duration;
  return out;
}

export function expandRecord(c, sport, state) {
  if (!c) return null;
  const rec = { sport, state };
  if (c.p) rec.per = c.p;
  if (c.n) rec.nReg = c.n;
  rec.ot = Boolean(c.o);
  if (c.f) rec.final = c.f;
  if (c.w) rec.winner = c.w;
  if (c.e) rec.events = c.e.map(([k, t, min]) => ({ k: KINDS[k], team: t ? 'away' : 'home', min }));
  if (c.s) rec.stats = c.s;
  if (c.g) {
    rec.games = c.g.split(',').map((x) => ({ s: Number(x[0]), w: x[1] === '1' ? 'home' : 'away', srv: x[2] === '1' ? 'home' : x[2] === '2' ? 'away' : null }));
  }
  if (c.d) rec.duration = c.d;
  return rec;
}
