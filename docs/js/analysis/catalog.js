// Catálogo de mercados: traduce el nombre de un mercado de una casa (Betano,
// Apuesta Total) y sus selecciones a una especificación común, que luego usan
// el modelo (probabilidad) y la liquidación (resultado real).
//
// Especificación de un mercado: { t, stat, scope, team, n }
//   t      tipo (ver TYPES)
//   stat   'score' (goles/puntos/carreras; en tenis, vóley... los sets) u otra
//          estadística: corners, cards, shots_on, games, aces...
//   scope  'ft' partido (lo que la casa liquida como "partido"), 'reg' tiempo
//          reglamentario, 'h1'/'h2' mitades, 'p1'..'p9' periodos o cuartos,
//          'i1'.. entradas, 'i1-5' primeras 5 entradas, 's1'.. sets/juegos/mapas,
//          'm0-10' minutos 0 a 10 (de juego), o grupos de periodos para
//          comparaciones: 'halves', 'periods', 'innings', 'sets12'
//   team   'home' | 'away' | null (estadística de un solo equipo)
//   n      parámetro extra (p. ej. "ambos marcan 2+" → n = 2; carrera a n)
// Selección: { sel, line }. Ejemplos: OU over 2.5 · 1X2 home · CS 2-1 ·
// AND "1X2~home~@h1+1X2~draw~" (combinadas de la casa, p. ej. medio tiempo/final).
//
// La clave de una selección es `${marketId(spec)}|${sel}|${line ?? ''}`; los
// mercados principales conservan las claves de antes (1X2, ML, DC, OU, BTTS, HCP).

export const TYPES = {
  '1X2': 'Resultado (con empate)',
  ML: 'Ganador (sin empate: se anula si empatan)',
  DC: 'Doble oportunidad',
  OU: 'Más/menos',
  OU3: 'Más/menos con exacto',
  HCP: 'Hándicap',
  HCP3: 'Hándicap con empate',
  BTTS: 'Ambos marcan',
  OE: 'Par/impar',
  CNT: 'Total exacto o rango',
  CS: 'Marcador correcto',
  MRG: 'Margen de victoria',
  FIRST: 'Primero en anotar',
  LAST: 'Último en anotar',
  RACE: 'Carrera a',
  FGT: 'Minuto del primer gol',
  PMAX: 'Periodo con más',
  MAXPER: 'Equipo con el mejor periodo',
  WINALL: 'Gana todos los periodos',
  WINANY: 'Gana algún periodo',
  SCOREALL: 'Anota en todos los periodos',
  ALLPER: 'Total en cada periodo',
  CLEAN: 'Gana sin recibir',
  COMEBACK: 'Gana tras ir perdiendo',
  OT: 'Hay prórroga',
  SEQ: 'Orden de los sets',
  GSEQ: 'Marcador tras N juegos',
  SVC1: 'Primer juego de saque',
  AND: 'Combinada de la casa',
  OR: 'Una u otra',
};

// Mercados que se reconocen pero no se pueden modelar ni liquidar con los
// datos de Sofascore y Flashscore.
export const UNSUPPORTED = {
  player: 'Mercado de jugador (faltan datos por jugador)',
  outright: 'Ganador de torneo o carrera (no es un partido)',
  special: 'Suceso sin datos para modelarlo o liquidarlo',
  unknown: 'Formato no reconocido',
};

// ---- Texto ----

export function clean(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9 .:+\-/&()[\]{}%,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STOP = new Set('fc cf sc ac afc cd ca club de del la el los las the fk sk sv if bk ik sd ud rc cs us as ss sl ec se ad cr fbc bc vfb vfl y and u20 u21 u23 sub w f'.split(' '));

// Reemplaza los nombres de los equipos por "local" / "visitante".
export function localize(text, home = '', away = '') {
  let s = ` ${clean(text)} `;
  const names = [
    [clean(home), 'local'],
    [clean(away), 'visitante'],
  ].filter(([n]) => n.length >= 2);
  // Primero el nombre completo (el más largo primero para no pisar otro).
  for (const [n, token] of [...names].sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`(^|[\\s(/&\\[-])${escapeRe(n)}(?=$|[\\s)/&:\\]-])`, 'g'), `$1${token}`);
  }
  // Luego palabras distintivas de cada nombre (p. ej. "Universitario" de "Club Universitario").
  for (const [n, token] of names) {
    const other = names.find((x) => x[1] !== token)?.[0] || '';
    const words = n.split(' ').filter((w) => w.length >= 4 && !STOP.has(w) && !other.split(' ').includes(w));
    for (const w of words) s = s.replace(new RegExp(`(^|[\\s(/&\\[-])${escapeRe(w)}(?=$|[\\s)/&:\\]-])`, 'g'), `$1${token}`);
  }
  return s.replace(/\b(local|visitante)(\s+\1)+\b/g, '$1').replace(/\s+/g, ' ').trim();
}

export const num = (s) => {
  const m = String(s).replace(',', '.').match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};
const numbers = (s) => [...String(s).matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

// ---- Identificador del mercado ----

export function marketId({ t, stat = 'score', scope = 'ft', team = null, n = null }) {
  let s = t;
  if (stat !== 'score') s += `.${stat}`;
  if (scope !== 'ft') s += `@${scope}`;
  if (team) s += `:${team}`;
  if (n != null) s += `#${n}`;
  return s;
}

export function parseMarketId(id) {
  const m = String(id).match(/^([A-Z0-9]+)(?:\.([a-z0-9_]+))?(?:@([a-z0-9-]+))?(?::(home|away))?(?:#(.+))?$/);
  if (!m) return null;
  const n = m[5] == null ? null : Number.isFinite(Number(m[5])) ? Number(m[5]) : m[5];
  return { t: m[1], stat: m[2] || 'score', scope: m[3] || 'ft', team: m[4] || null, n };
}

export const selectionKey = (spec, sel, line) => `${typeof spec === 'string' ? spec : marketId(spec)}|${sel}|${line ?? ''}`;

// Partes de una combinada: "1X2~home~@h1+OU~over~2.5" (mercado~sel~línea).
export const encodeParts = (parts) => parts.map((p) => `${marketId(p.spec)}~${p.sel}~${p.line ?? ''}`).join('+');
export function decodeParts(sel) {
  return String(sel)
    .split('+')
    .map((x) => {
      const [id, s, line] = x.split('~');
      return { spec: parseMarketId(id), sel: s, line: line === '' || line == null ? null : Number(line) };
    });
}

// ---- Selecciones ----

const SIDE = { 1: 'home', local: 'home', x: 'draw', empate: 'draw', 2: 'away', visitante: 'away' };
const NONE = /^(sin goles|sin gol|ninguno|ningun equipo|ningun|sin tarjetas rojas|sin amonestaciones|sin anotacion|ninguna|no hay goles|nadie)$/;

// Lado de una selección: home | draw | away | none | null.
export function sideOf(text) {
  const t = clean(text).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (SIDE[t]) return SIDE[t];
  if (NONE.test(t)) return 'none';
  const first = t.split(/[\s,]+/)[0];
  if (first === 'local' || first === 'visitante' || first === 'empate') return SIDE[first];
  if (/^(1|2|x)\s*\((local|visitante|empate)\)$/.test(t)) return SIDE[t[0]];
  return null;
}

// "Más de 2.5" / "Menos 2.5" / "Over" / "3+" / "Exactamente 7.0".
export function ouOf(text, fallbackLine = NaN) {
  const t = clean(text);
  const line = Number.isFinite(num(t)) ? num(t) : fallbackLine;
  if (/^(mas|over|\+)\b|^mas de\b/.test(t)) return { sel: 'over', line };
  if (/^(menos|under)\b/.test(t)) return { sel: 'under', line };
  if (/^exactamente\b/.test(t)) return { sel: 'exact', line };
  const plus = t.match(/^(\d+)\s*\+$/);
  if (plus) return { sel: 'over', line: Number(plus[1]) - 0.5 };
  return null;
}

const YES = /^(si|yes|s)$/;
const NO = /^(no)$/;
export function yesNo(text) {
  const t = clean(text).replace(/\s+\d+(\.\d+)?$/, '');
  if (YES.test(t)) return 'yes';
  if (NO.test(t)) return 'no';
  return null;
}

const DC_TEXT = { '1x': '1X', x1: '1X', 'local o empate': '1X', 'local/empate': '1X', 'empate o local': '1X', x2: 'X2', '2x': 'X2', 'visitante o empate': 'X2', 'empate o visitante': 'X2', 'visitante/empate': 'X2', 'empate/visitante': 'X2', 12: '12', 21: '12', 'local o visitante': '12', 'local/visitante': '12', 'visitante o local': '12' };
export const dcOf = (text) => DC_TEXT[clean(text).replace(/\s*\/\s*/g, '/')] || DC_TEXT[clean(text).replace(/\s+/g, '')] || null;

// Marcador "2 - 1", "2:1", "3+-0".
export function scoreOf(text) {
  const m = clean(text).replace(/[()]/g, '').match(/^(\d+\+?)\s*[-:]\s*(\d+\+?)$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// ---- Partes del nombre ----

const STATS = [
  // [regex sobre el nombre, código]. El orden importa (lo específico primero).
  [/aces (y|&) faltas dobles|aces & faltas dobles/, 'acesdf'],
  [/faltas dobles|falta doble/, 'df'],
  [/\baces?\b/, 'aces'],
  [/tie[ -]?breaks?/, 'tiebreaks'],
  [/breaks? de servicio|quiebres? de servicio|\bquiebres?\b|primer break/, 'breaks'],
  [/duracion/, 'duration'],
  [/puntos de tarjetas/, 'cards'],
  [/tarjetas? rojas?/, 'reds'],
  [/tarjeta|amonestacion/, 'cards'],
  [/corner|corneres|tiros? de esquina/, 'corners'],
  [/tiros al arco|remates a puerta|tiros a puerta/, 'shots_on'],
  [/tiros a porteria/, 'sog'],
  [/remates totales|tiros totales/, 'shots'],
  [/faltas cometidas|\bfaltas\b/, 'fouls'],
  [/offside|fueras? de juego/, 'offsides'],
  [/saques de meta|saques de puerta/, 'goalkicks'],
  [/saques de banda/, 'throwins'],
  [/\bpalo\b/, 'woodwork'],
  [/\bautogol/, 'owngoals'],
  [/minutos de penalizacion/, 'pim'],
  [/equipo que anota un penal/, 'pengoals'],
  [/penal concedido|penales concedidos|\bpenal\b/, 'pens'],
  [/tackles/, 'tackles'],
  [/powerplay/, 'ppg'],
  [/shorthanded/, 'shg'],
  [/porteria vacia/, 'eng'],
  [/tiros de tres|triples|tiros de 3/, 'threes'],
  [/tiros de 2|tiros de dos/, 'twos'],
  [/tiros libres|lanzamientos libres/, 'ftm'],
  [/rebotes ofensivos/, 'oreb'],
  [/rebotes defensivos/, 'dreb'],
  [/rebotes/, 'reb'],
  [/asistencias/, 'ast'],
  [/perdidas de balon|turnovers/, 'tov'],
  [/touchdowns? de pase|touchdowns pasando/, 'pass_tds'],
  [/touchdowns? de recepcion/, 'pass_tds'],
  [/touchdowns? por carrera|rushing touchdowns/, 'rush_tds'],
  [/touchdowns?/, 'tds'],
  [/yardas de carrera y de recepcion|yardas de corrida y de recepcion/, 'total_yds'],
  [/net passing yards|yardas de pase|yardas de recepcion/, 'pass_yds'],
  [/yardas de carrera/, 'rush_yds'],
  [/intentos de carrera/, 'rush_att'],
  [/recepciones/, 'receptions'],
  [/\b180s?\b/, '180s'],
  [/checkout/, 'checkout'],
  [/etapas/, 'legs'],
  [/rondas?|\brounds?\b/, 'rounds'],
  [/mapas?/, 'maps'],
  [/\bhits\b/, 'hits'],
  [/scoreless innings/, 'scoreless_inn'],
  [/tied innings/, 'tied_inn'],
  [/entradas ganadas/, 'innings_won'],
  [/entradas en las que ambos equipos han anotado/, 'both_scored_inn'],
  [/sencillos/, 'singles'],
  [/\bdobles\b/, 'doubles'],
  [/\bpases\b/, 'passes'],
  [/games|juegos/, 'games'],
];

// Estadísticas que no trae Flashscore (no se pueden liquidar).
const NO_DATA_STATS = new Set(['rush_att', 'receptions', 'singles', 'doubles', 'checkout']);

// Deportes en los que "puntos" no es el marcador sino los puntos de los sets.
const RALLY = new Set(['table-tennis', 'badminton', 'volleyball', 'beach-volley']);
// Deportes que se ganan por sets/juegos/mapas.
// Deportes en los que el partido no termina empatado (prórroga, entradas extra...).
export const OT_SPORTS = new Set(['basketball', 'ice-hockey', 'baseball', 'american-football', 'floorball']);
export const SET_SPORTS = new Set(['tennis', 'volleyball', 'beach-volley', 'table-tennis', 'badminton', 'darts', 'esports', 'snooker']);

function statOf(name, sport) {
  for (const [re, code] of STATS) {
    if (!re.test(name)) continue;
    if (code === 'games' && sport !== 'tennis') continue;
    if (code === 'ast' && sport === 'football') continue; // asistencias de jugador
    if (code === 'doubles' && sport !== 'baseball') continue;
    if (code === 'rounds' && sport === 'esports' && /rondas? de pistola|ronda ganadora/.test(name)) return 'pistol';
    if (code === 'maps') return 'score';
    return code;
  }
  if (RALLY.has(sport) && /\bpuntos\b/.test(name)) return 'points';
  if (sport === 'tennis' && /\bsets?\b/.test(name) && /(gana|ganan) un set|cantidad de sets|handicap de partido \(set\)|apuesta de set|sets? hand/.test(name)) return 'score';
  return 'score';
}

const ORD = { primer: 1, primero: 1, primera: 1, '1er': 1, '1ra': 1, '1o': 1, '1': 1, segundo: 2, segunda: 2, '2do': 2, '2da': 2, '2o': 2, '2': 2, tercer: 3, tercero: 3, tercera: 3, '3er': 3, '3ra': 3, '3': 3, cuarto: 4, '4to': 4, '4': 4, quinto: 5, '5to': 5, '5': 5 };

function scopeOf(name, sport) {
  // Ventanas de minutos.
  const win = name.match(/(\d{1,2}):\d{2}\s*-\s*(\d{1,2}):(\d{2})/);
  if (win && !/hora del proximo gol/.test(name)) {
    const from = Number(win[1]);
    const to = Number(win[2]) + (Number(win[3]) >= 59 ? 1 : 0);
    return `m${from}-${to}`;
  }
  const before = name.match(/antes (?:de(?:l minuto)? )?(\d{1,2}):00/) || name.match(/antes del minuto (\d{1,2})/);
  if (before) return `m0-${Number(before[1])}`;
  const after = name.match(/despues del minuto (\d{1,2})/);
  if (after) return `m${Number(after[1])}-`;
  // Béisbol: entradas.
  const innings = name.match(/(\d) entradas completas/);
  if (innings) return `i1-${innings[1]}`;
  const after2 = name.match(/despues del inning (\d)|al (\d)(?:to|vo|mo|er|do|ro|no)? inning/);
  if (after2) return `i1-${after2[1] || after2[2]}`;
  const inning = name.match(/inning (\d)|(\d)(?:er|ro|do|to|vo|mo|no)? inning|(\d)a? entrada\b/);
  if (inning) return `i${inning[1] || inning[2] || inning[3]}`;
  // Sets, juegos (tenis de mesa), mapas.
  const set = name.match(/\(?(?:set|juego|mapa) (\d)\)?/) || name.match(/(primer|1er|segundo|2do|tercer|3er) set/);
  if (set && !/primer juego de servicio/.test(name)) return `s${ORD[set[1]] || Number(set[1])}`;
  if (/los dos primeros|despues de 2 sets/.test(name)) return 's1-2';
  // Periodos / cuartos.
  const per = name.match(/(primer|1er|segundo|2do|tercer|3er|cuarto|4to)\s+(?:periodo|cuarto)\b/) || name.match(/(?:periodo|cuarto)\s+(\d)/);
  if (per && !/con mayor puntuacion|cada cuarto|todos los/.test(name)) return `p${ORD[per[1]] || Number(per[1])}`;
  if (/primer cuarto/.test(name)) return 'p1';
  // Mitades.
  if (/primer tiempo\s*\/\s*tiempo completo|medio tiempo\s*\/\s*tiempo completo|primer tiempo o tiempo completo/.test(name)) return 'ft';
  if (/mitad\s*\/\s*final|descanso\s*\/\s*final/.test(name)) return 'ft';
  if (/primer tiempo|1er tiempo|medio tiempo|primera mitad|\b1(ra|a)? mitad|\b1 mitad|1ra parte/.test(name)) return 'h1';
  if (/segundo tiempo|2do tiempo|segunda mitad|\b2(da|a)? mitad|\b2 mitad/.test(name)) return 'h2';
  if (/tiempo reg|tiempo regular|fin tiempo reg/.test(name)) return 'reg';
  return 'ft';
}

// Equipo al que se refiere el mercado ("Local Total de goles").
function teamOf(name) {
  const t = ` ${name} `;
  if (/\[local\/visitante\]/.test(t)) return null;
  const home = /(^|[\s(-])local([\s):-]|$)/.test(t);
  const away = /(^|[\s(-])visitante([\s):-]|$)/.test(t);
  if (home && !away) return 'home';
  if (away && !home) return 'away';
  return null;
}

// ---- Reglas por tipo de mercado ----

const unsupported = (kind) => ({ unsupported: kind, reason: UNSUPPORTED[kind] });

const PLAYER = /\[jugador|jugador\]|(?<!ambos )jugadores|goleador|anotar en cualquier momento|anotador|en cualquier momento|triplete|ultimo en marcar|recibir una tarjeta|recibe una tarjeta roja|jugador que|el jugador|anota desde fuera|consigue una blanqueada|\bh2h\b|mas puntos en el partido|mas rebotes en el partido|mas asistencias en un partido|mas tiros de 3 puntos anotados|mejor anotador|jonrones|ponches|cualquiera\/o|combinados \d\+ touchdown|encuentros \(|\[ross|\[jamie/;
const OUTRIGHT = /campeon|ganador absoluto|termina en el podio|vuelta mas rapida|termina entre|final con puntos|auto ganador|auto que hace|parada en boxes|ultimo clasificado|a clasificar|pilotos clasificados|coche de seguridad|bandera roja|primer piloto|retiro del primer|ganador de la clasificacion|primera posicion/;
const SPECIAL = /forma de anotacion|forma del (primer|ultimo) punto|forma de la primera anotacion|que ocurrira primero|bocina|resultado del 1er drive|conversion exitosa|seguridad anotada|equipos especiales|cualquiera de los arqueros|ganador de la ronda|ronda de pistolas|carrera a rondas|tiempo extra \(mapa|cantidad de sets para superar|ganador de puntos \(punto|forma del triunfo|apuesta de ronda|por ko|por decision|llegara la lucha|en que minuto|ronda ganadora|especiales del partido|equipo que falla un penal|dos penales|ambos equipos ganan un penal|primer offside|primer ace|primera falta doble|carrera a 2|forma de anotacion|carrera a x puntos|carrera a \d+ puntos|resultado exacto de las rondas|total de rounds|total rounds|rondas.*(mma)|primera mitad \(mapa|primer tiempo \(mapa|segundo tiempo \(mapa|fin tiempo reg\. \(mapa|fin tiempo reg \(mapa|ganador de la primera mitad|\[local\/visitante\]/;

// ¿Las selecciones son los dos equipos (partido) o una lista de participantes (torneo)?
function sideLike(selections, ctx) {
  return selections.length > 0 && selections.length <= 3 && selections.every((s) => sideOf(localize(s.name, ctx.home, ctx.away)));
}

// Tipo del mercado según el nombre (sin mirar las selecciones). null: decidir por las selecciones.
function typeFromName(name, sport) {
  if (/par\s*\/\s*impar|impar\s*\/\s*par|par impar|impar par|\bpar\/impar\b/.test(name)) return 'OE';
  if (/doble resultado, set y partido|ambos jugadores ganan un set x resultado/.test(name)) return 'AND';
  if (/primer tiempo\s*\/\s*tiempo completo|medio tiempo\s*\/\s*tiempo completo|tarjetas de medio tiempo\/tiempo completo|primer tiempo\/tiempo completo corners|mitad\s*\/\s*final|descanso\s*\/\s*final/.test(name)) return 'HTFT';
  if (/ y mas\/menos| con mas\/menos|& total de|y total de|ganador del partido y mas\/menos|ganador & total|ganador y total|resultado & ambos|ambos anotan y mas|ambos equipos anotan & total|resultado del partido \/ ambos|doble oportunidad \/ ambos|primer equipo en anotar & |ganador del mapa &|ganador del partido & ganador del mapa|periodo 1 - resultado & resultado|gana & partido sobrepasa|ganador & (local|visitante) total|ganador del set y total/.test(name)) return 'AND';
  if (/ambos equipos anotan o mas/.test(name)) return 'BTTSOVER';
  if (/ o ambos equipos anotan| o goles totales|resultado primer tiempo o tiempo completo/.test(name)) return 'OR';
  if (/tarjeta roja (y|o) penal/.test(name)) return 'REDPEN';
  if (/ambos equipos anotan en el primer tiempo\s*\/\s*segundo tiempo/.test(name)) return 'BTTSHALVES';
  if (/ambos equipos anotan o mas/.test(name)) return 'BTTSOVER';
  if (/curso del juego/.test(name)) return 'COURSE';
  if (/porteria a cero/.test(name)) return 'CLEANSHEET';
  if (/ganara sin recibir/.test(name)) return 'CLEAN';
  if (/set termina 6:0 o 0:6|set termina 6 0 o 0 6/.test(name)) return 'ANYSET';
  if (/puntuacion luego de (\d) juegos/.test(name)) return 'GSEQ';
  if (/marcador correcto|marcador exacto|apuesta de set|puntuacion del set|puntuacion despues de 2 sets|resultado correcto|marcador correcto del set|marcador set/.test(name)) return 'CS';
  if (/margen del triunfo|margen de victoria/.test(name)) return 'MRG';
  if (/cualquier equipo gana por \d/.test(name)) return 'MRGYN';
  if (/hora del proximo gol/.test(name)) return 'FGT';
  if (/tiempo del primer gol/.test(name)) return 'FGT';
  if (/goles exactos|rango(?! de resultados)|^total de corners$/.test(name)) return 'CNT';
  if (/cantidad de sets en el partido|gana exactamente|goles exactos/.test(name)) return 'CNT';
  if (/3-way total/.test(name)) return 'OU3';
  if (/handicap.*(triple|- triples)|handicap resultado del partido|handicap - triple|- triples|handicap 1x2/.test(name)) return 'HCP3';
  if (/handicap|hand\b|linea de puck|run line|linea de carreras/.test(name)) return 'HCP';
  if (/doble oportunidad/.test(name)) return 'DC';
  if (/apuesta sin empate|primer equipo en anotar apuesta sin empate/.test(name)) return 'ML';
  if (/ambos equipos anotan|ambos equipos reciben|ambos jugadores ganan un set/.test(name)) return 'BTTS';
  if (/primer equipo en anotar \d goles|carrera a \d|carrera a x/.test(name)) return 'RACE';
  if (/(gol|tarjeta|anotacion|carrera).*(antes|despues|luego) del? (minuto )?\d|primer gol antes|gol anotado despues|gol anotado entre/.test(name) && !/hora del|proximo gol antes/.test(name)) return 'WINDOW';
  if (/proximo gol|primer equipo en anotar|primer break|proximo equipo en recibir la tarjeta roja|^primer gol$/.test(name)) return 'FIRST';
  if (/ultimo equipo en anotar|ultimo en anotar|^ultimo gol$|ultimo equipo con tarjeta/.test(name)) return 'LAST';
  if (/tiempo con mas|tiempo con puntuacion mas alta|medio tiempo con mas|cuarto con mayor|periodo con mayor|entrada de mayor|set con la mayoria/.test(name)) return 'PMAX';
  if (/equipo con la mayor puntuacion en un cuarto|tiempo - equipo con mayor puntuacion|highest scoring inning/.test(name)) return 'MAXPER';
  if (/gana todos|ganar todos|gana ambos tiempos|gana cada cuarto|equipo que gana ambos tiempos/.test(name)) return 'WINALL';
  if (/gana cualquier(a)? (de los tiempos|periodo)/.test(name)) return 'WINANY';
  if (/anota en todos los periodos|anota en ambos tiempos|al menos 1 gol en todos los periodos|gol anotado en ambos tiempos|marcador en cada cuarto/.test(name)) return 'SCOREALL';
  if (/en todos los periodos (mas de|menos)|goles anotados en cada tiempo|goles anotados en ambos tiempos/.test(name)) return 'ALLPER';
  if (/gana a cero/.test(name)) return 'CLEAN';
  if (/gana luego de ir perdiendo/.test(name)) return 'COMEBACK';
  if (/tiempo extra|tiempo suplementario|entradas extra/.test(name)) return 'OT';
  if (/setcast/.test(name)) return 'SEQ';
  if (/ganador del primer juego de servicio/.test(name)) return 'SVC1';
  if (/equipo con mas|mas quiebres|mas aces|mas faltas dobles|mas 180s|mas alto checkout/.test(name)) return 'MOST';
  return null;
}

// Traduce un mercado. selections: [{ name, price, line? }]. ctx: { sport, home, away }.
// Devuelve { spec, outcomes: [{ sel, line, price, label }] }, o { unsupported, reason }, o null (ignorar).
export function parseMarket(rawName, selections = [], ctx = {}) {
  const sport = ctx.sport || 'football';
  const name = localize(rawName, ctx.home, ctx.away);
  if (/super ?cuota|supercuota|boost|mejorada|cuota aumentada/.test(name)) return null;
  if (OUTRIGHT.test(name) || ['cricket', 'cycling', 'motorsport'].includes(sport) || (sport === 'snooker' && !sideLike(selections, ctx))) return unsupported('outright');
  if (PLAYER.test(name)) return unsupported('player');
  if (SPECIAL.test(name)) return unsupported('special');
  const sels = selections
    .map((s) => ({ raw: s.name, text: localize(s.name, ctx.home, ctx.away), price: Number(s.price), line: s.line != null ? Number(s.line) : NaN }))
    .filter((s) => s.price > 1);
  if (!sels.length) return null;

  let stat = statOf(name, sport);
  if (NO_DATA_STATS.has(stat)) return unsupported('special');
  if (stat === 'pistol') return unsupported('special');
  let scope = scopeOf(name, sport);
  const team = teamOf(name);
  let type = typeFromName(name, sport);
  const nameLine = numbers(name.replace(/\d{1,2}:\d{2}/g, '')).filter((x) => !Number.isInteger(x) || /\(\d+\.?\d*\)|mas de \d|menos \d/.test(name)).pop();

  // Por las selecciones, si el nombre no lo dijo.
  if (!type) {
    if (sels.every((s) => ouOf(s.text))) type = 'OU';
    else if (sels.every((s) => yesNo(s.text))) type = 'YN';
    else if (sels.every((s) => dcOf(s.text))) type = 'DC';
    else if (sels.every((s) => sideOf(s.text))) type = 'SIDE';
    else if (sels.every((s) => /^\d+(\s*-\s*\d+|\s*\+)?$/.test(clean(s.text))) && sels.some((s) => /^\d+(\s*\+)?$/.test(clean(s.text)))) type = 'CNT';
    else if (sels.every((s) => scoreOf(s.text))) type = 'CS';
    else return unsupported('unknown');
  }
  // "Total de córners" puede venir por rangos (0-8, 9-11...) o con Más/Menos.
  if (type === 'CNT' && sels.every((s) => ouOf(s.text))) type = 'OU';
  const base = { stat, scope, team: null, n: null };
  const out = [];
  const add = (spec, sel, line, s) => {
    if (sel == null) return;
    // Las combinadas no tienen estadística, periodo ni equipo propios: los llevan sus partes.
    const sp = spec.t === 'AND' || spec.t === 'OR' ? { ...spec, stat: 'score', scope: 'ft', team: null, n: null } : spec;
    out.push({ spec: sp, sel, line: Number.isFinite(line) ? line : null, price: s.price, label: s.raw });
  };
  const scoreStat = stat === 'score';

  switch (type) {
    case 'OU':
    case 'OU3': {
      const spec = { ...base, t: type, team, stat: stat === 'sets' && SET_SPORTS.has(sport) ? 'score' : stat };
      for (const s of sels) {
        const o = ouOf(s.text, Number.isFinite(s.line) ? s.line : nameLine);
        if (!o || !Number.isFinite(o.line)) continue;
        add(spec, o.sel, o.line, s);
      }
      break;
    }
    case 'YN': {
      // Sí/No sobre "al menos uno": tarjeta roja, penal, autogol, gol en una ventana...
      const spec = { ...base, t: 'OU', team };
      if (scoreStat && /gana|ganan/.test(name)) {
        // "Local Gana un Set": sets ganados por un jugador.
        if (sport !== 'tennis' && !SET_SPORTS.has(sport)) return unsupported('unknown');
        const exact = name.match(/exactamente (\d)/);
        if (exact) {
          for (const s of sels) add({ ...base, t: 'CNT', team: team || 'away' }, yesNo(s.text) === 'yes' ? exact[1] : `!${exact[1]}`, null, s);
          break;
        }
        for (const s of sels) add({ ...spec, team: team || 'away' }, yesNo(s.text) === 'yes' ? 'over' : 'under', 0.5, s);
        break;
      }
      for (const s of sels) add(spec, yesNo(s.text) === 'yes' ? 'over' : 'under', 0.5, s);
      break;
    }
    case 'DC': {
      const spec = { ...base, t: 'DC' };
      for (const s of sels) add(spec, dcOf(s.text), null, s);
      break;
    }
    case 'BTTS': {
      const k = numbers(name).find((x) => Number.isInteger(x) && x >= 2 && x <= 9);
      const spec = { ...base, t: 'BTTS', stat: /ambos jugadores ganan un set/.test(name) ? 'score' : stat, n: k ?? null };
      if (/ambos jugadores ganan un set/.test(name)) spec.t = 'BTTS';
      if (/en ambos tiempos/.test(name)) return unsupported('special');
      for (const s of sels) add(spec, yesNo(s.text), null, s);
      break;
    }
    case 'OE': {
      const spec = { ...base, t: 'OE', team };
      for (const s of sels) {
        const t = clean(s.text);
        add(spec, /^impar|^odd/.test(t) ? 'odd' : /^par|^even/.test(t) ? 'even' : null, null, s);
      }
      break;
    }
    case 'ML':
    case 'SIDE':
    case 'MOST': {
      const sides = sels.map((s) => sideOf(s.text));
      const hasDraw = sides.includes('draw');
      const isMost = type === 'MOST' || (!scoreStat && stat !== 'sets');
      const t = /primer equipo en anotar apuesta sin empate/.test(name) ? 'FIRST' : hasDraw ? '1X2' : 'ML';
      const spec = { ...base, t: t === 'FIRST' ? 'FIRST' : t, stat: stat === 'sets' ? 'score' : stat };
      // Resultado con empate en deportes con prórroga: es el del tiempo reglamentario.
      if (spec.t === '1X2' && spec.scope === 'ft' && scoreStat && OT_SPORTS.has(sport)) spec.scope = 'reg';
      if (isMost && !scoreStat && stat !== 'sets' && type !== 'ML' && !/gana|ganador|resultado/.test(name)) spec.t = hasDraw ? '1X2' : 'ML';
      if (stat === 'pengoals') {
        // "Equipo que anota un penal": cada selección es un "sí" para ese equipo.
        sels.forEach((s, i) => ['home', 'away'].includes(sides[i]) && add({ ...base, t: 'OU', team: sides[i] }, 'over', 0.5, s));
        break;
      }
      sels.forEach((s, i) => sides[i] !== 'none' && add(spec, sides[i], null, s));
      break;
    }
    case 'HCP':
    case 'HCP3': {
      const spec = { ...base, t: type, stat: stat === 'sets' ? 'score' : stat };
      if (sport === 'tennis' && /set/.test(name) && !/games|juegos/.test(name)) spec.stat = 'score';
      if (sport === 'tennis' && /games|juegos/.test(name)) spec.stat = 'games';
      for (const s of sels) {
        const side = sideOf(s.text.replace(/\(?[+-]?\d+(\.\d+)?\)?/g, ' ').replace(/\s+/g, ' ').trim());
        const value = Number.isFinite(num(s.text)) ? num(s.text) : Number.isFinite(s.line) ? s.line : NaN;
        if (!side || side === 'none' || !Number.isFinite(value)) continue;
        if (type === 'HCP' && side === 'draw') continue;
        // La línea siempre es el hándicap del local.
        const line = side === 'away' ? -value : value;
        add(spec, side, line, s);
      }
      // En hándicap con empate todas las selecciones comparten la línea del local.
      if (type === 'HCP3') {
        const homeLine = out.find((o) => o.sel === 'home')?.line ?? (out.find((o) => o.sel === 'draw')?.line);
        for (const o of out) o.line = homeLine;
      }
      break;
    }
    case 'CNT': {
      const spec = { ...base, t: 'CNT', team, stat: /sets/.test(name) ? 'score' : stat };
      const exactly = name.match(/gana exactamente (\d)/);
      if (exactly) {
        for (const s of sels) {
          const yn = yesNo(s.text);
          if (yn) add({ ...spec, team: team || 'away' }, yn === 'yes' ? exactly[1] : `!${exactly[1]}`, null, s);
        }
        break;
      }
      for (const s of sels) {
        const t = clean(s.text).replace(/^no hay goles?$|^sin goles$/, '0').replace(/\b(sets?|goles?|gol|juegos|games|puntos)\b/g, '').trim();
        let sel = null;
        if (/^\d+$/.test(t)) sel = t;
        else if (/^\d+\s*-\s*\d+$/.test(t)) sel = t.replace(/\s/g, '');
        else if (/^\d+\s*\+$|^\d+ o mas$/.test(t)) sel = `${num(t)}+`;
        add(spec, sel, null, s);
      }
      break;
    }
    case 'CS':
      return parseCorrectScore(name, sels, { ...base, stat: stat === 'sets' ? 'score' : stat }, sport, out, add);
    case 'MRG': {
      const spec = { ...base, t: 'MRG' };
      for (const s of sels) add(spec, marginOf(s.text), null, s);
      break;
    }
    case 'FIRST':
    case 'RACE': {
      const k = type === 'RACE' ? numbers(name).find((x) => Number.isInteger(x) && x > 1) : null;
      const spec = { ...base, t: type, n: k ?? null };
      for (const s of sels) {
        const side = sideOf(s.text);
        add(spec, side === 'draw' ? 'none' : side, null, s);
      }
      break;
    }
    case 'FGT': {
      const spec = { ...base, t: 'FGT', team, scope: 'ft' };
      for (const s of sels) {
        const t = clean(s.text);
        if (NONE.test(t)) add(spec, 'none', null, s);
        else if (/mas 28|mas de 28/.test(t)) add(spec, '28-', null, s);
        else if (/menos de 27/.test(t)) add(spec, '0-28', null, s);
        else {
          const m = t.match(/(\d{1,2}):\d{2}\s*-\s*(\d{1,2})(?::(\d{2}))?/);
          if (m) add(spec, `${Number(m[1])}-${m[3] ? Number(m[2]) + 1 : ''}`, null, s);
        }
      }
      break;
    }
    case 'PMAX': {
      const group = /cuarto/.test(name) ? 'periods' : /periodo/.test(name) ? 'periods' : /entrada/.test(name) ? 'innings' : /set/.test(name) ? 'sets12' : 'halves';
      const spec = { ...base, t: 'PMAX', scope: group };
      for (const s of sels) {
        const t = clean(s.text);
        let sel = null;
        if (/empate|equal|igual/.test(t)) sel = 'tie';
        else if (group === 'halves') sel = /primer/.test(t) ? 'h1' : /segundo/.test(t) ? 'h2' : null;
        else if (group === 'sets12') sel = /primer/.test(t) ? 's1' : /segundo/.test(t) ? 's2' : null;
        else {
          const k = ORD[t.split(' ')[0]] || num(t);
          if (Number.isFinite(k)) sel = `${group === 'innings' ? 'i' : 'p'}${k}`;
        }
        add(spec, sel, null, s);
      }
      break;
    }
    case 'MAXPER': {
      const group = /cuarto/.test(name) ? 'periods' : /inning/.test(name) ? 'innings' : 'halves';
      const spec = { ...base, t: 'MAXPER', scope: group };
      for (const s of sels) add(spec, sideOf(s.text) === 'none' ? null : sideOf(s.text), null, s);
      break;
    }
    case 'WINALL':
    case 'WINANY':
    case 'SCOREALL': {
      const group = /cuarto/.test(name) ? 'periods' : /periodo/.test(name) ? 'periods' : 'halves';
      const spec = { ...base, t: type, scope: group, team };
      for (const s of sels) {
        const yn = yesNo(s.text);
        if (yn) add(spec, yn, null, s);
        else {
          const side = sideOf(s.text);
          if (side === 'home' || side === 'away') add({ ...spec, team: side }, 'yes', null, s);
          else if (side === 'none' && type === 'WINALL') add({ ...spec, team: null }, 'no', null, s);
        }
      }
      break;
    }
    case 'ALLPER': {
      const group = /periodo/.test(name) ? 'periods' : 'halves';
      const dir = /menos/.test(name) ? 'under' : 'over';
      const lineName = numbers(name).find((x) => !Number.isInteger(x));
      const spec = { ...base, t: 'ALLPER', scope: group, n: dir };
      for (const s of sels) {
        const line = Number.isFinite(num(s.text)) ? num(s.text) : lineName;
        add(spec, yesNo(s.text), line, s);
      }
      break;
    }
    case 'CLEAN':
    case 'COMEBACK':
    case 'OT': {
      const spec = { ...base, t: type, team, scope: type === 'OT' ? 'ft' : scope, stat: type === 'COMEBACK' && /sets/.test(name) ? 'score' : stat };
      for (const s of sels) {
        const yn = yesNo(s.text);
        const side = yn ? null : sideOf(s.text);
        if (yn) add(spec, yn, null, s);
        else if (side === 'home' || side === 'away') add({ ...spec, team: side }, 'yes', null, s);
      }
      break;
    }
    case 'SEQ': {
      const spec = { ...base, t: 'SEQ' };
      for (const s of sels) {
        const parts = clean(s.text).split(/\s*-\s*/).map((p) => (p === 'local' ? 'h' : p === 'visitante' ? 'a' : null));
        add(spec, parts.every(Boolean) ? parts.join('') : null, null, s);
      }
      break;
    }
    case 'SVC1': {
      const server = /\(visitante\)/.test(name) ? 'away' : 'home';
      const spec = { ...base, t: 'SVC1', team: server };
      for (const s of sels) add(spec, sideOf(s.text), null, s);
      break;
    }
    case 'WINDOW': {
      // "Gol antes del minuto 32" / "Ningún gol antes..." / "Gol luego del minuto 70".
      const spec = { ...base, t: 'OU', team };
      for (const s of sels) {
        const t = clean(s.text);
        const yn = yesNo(t) || (/^(ningun|no hay|sin)\b/.test(t) ? 'no' : /^(gol|tarjeta|si)\b/.test(t) ? 'yes' : null);
        add(spec, yn === 'yes' ? 'over' : yn === 'no' ? 'under' : null, 0.5, s);
      }
      break;
    }
    case 'LAST': {
      const spec = { ...base, t: 'LAST', stat: /tarjeta/.test(name) ? 'cards' : stat };
      for (const s of sels) {
        const side = sideOf(s.text);
        add(spec, side === 'draw' ? 'none' : side, null, s);
      }
      break;
    }
    case 'MRGYN': {
      const k = numbers(name).find((x) => Number.isInteger(x));
      const spec = { ...base, t: 'MRG' };
      for (const s of sels) {
        const yn = yesNo(s.text);
        if (yn) add(spec, yn === 'yes' ? `any:${k}+` : `!any:${k}+`, null, s);
      }
      break;
    }
    case 'CLEANSHEET': {
      // "Bélgica: Mantendrá portería a cero" → el rival no anota.
      const opp = team === 'home' ? 'away' : team === 'away' ? 'home' : null;
      if (!opp) return unsupported('unknown');
      const spec = { ...base, t: 'OU', team: opp };
      for (const s of sels) {
        const yn = yesNo(s.text);
        add(spec, yn === 'yes' ? 'under' : yn === 'no' ? 'over' : null, 0.5, s);
      }
      break;
    }
    case 'REDPEN': {
      const op = / o penal/.test(name) ? 'OR' : 'AND';
      const parts = [
        { spec: { ...base, t: 'OU', stat: 'reds' }, sel: 'over', line: 0.5 },
        { spec: { ...base, t: 'OU', stat: 'pens' }, sel: 'over', line: 0.5 },
      ];
      for (const s of sels) {
        const yn = yesNo(s.text);
        if (yn) add({ ...base, t: op }, `${yn === 'no' ? '!' : ''}${encodeParts(parts)}`, null, s);
      }
      break;
    }
    case 'BTTSOVER': {
      // Sí = ambos marcan o más de 2.5; No = lo contrario.
      const line = numbers(name).find((x) => !Number.isInteger(x)) ?? 2.5;
      const parts = [
        { spec: { ...base, t: 'BTTS' }, sel: 'yes' },
        { spec: { ...base, t: 'OU' }, sel: 'over', line },
      ];
      for (const s of sels) {
        const yn = yesNo(clean(s.text).split(' ')[0]);
        if (yn) add({ ...base, t: 'OR' }, `${yn === 'no' ? '!' : ''}${encodeParts(parts)}`, null, s);
      }
      break;
    }
    case 'BTTSHALVES': {
      for (const s of sels) {
        const [a, b] = clean(s.text).split(/\s+y\s+/);
        const ya = yesNo(a);
        const yb = yesNo(b);
        if (!ya || !yb) continue;
        add({ ...base, t: 'AND' }, encodeParts([{ spec: { ...base, t: 'BTTS', scope: 'h1' }, sel: ya }, { spec: { ...base, t: 'BTTS', scope: 'h2' }, sel: yb }]), null, s);
      }
      break;
    }
    case 'COURSE': {
      for (const s of sels) {
        const t = clean(s.text);
        if (NONE.test(t)) {
          add({ ...base, t: 'CS' }, '0-0', null, s);
          continue;
        }
        const first = /^local/.test(t) ? 'home' : /^visitante/.test(t) ? 'away' : null;
        if (!first) continue;
        const other = first === 'home' ? 'away' : 'home';
        const res = /gana/.test(t) ? first : /empata/.test(t) ? 'draw' : /pierde/.test(t) ? other : null;
        if (!res) continue;
        add({ ...base, t: 'AND' }, encodeParts([{ spec: { ...base, t: 'FIRST' }, sel: first }, { spec: { ...base, t: '1X2' }, sel: res }]), null, s);
      }
      break;
    }
    case 'ANYSET': {
      const spec = { ...base, t: 'CSANY', stat: 'games', n: '6-0,0-6' };
      for (const s of sels) add(spec, yesNo(s.text), null, s);
      break;
    }
    case 'GSEQ': {
      const k = Number(name.match(/puntuacion luego de (\d) juegos/)[1]);
      const spec = { ...base, t: 'GSEQ', stat: 'games', scope: scope.startsWith('s') ? scope : 's1', n: k };
      for (const s of sels) add(spec, scoreOf(s.text), null, s);
      break;
    }
    case 'HTFT':
      if (/doble oportunidad/.test(name)) return parseCombo(name, sels, base, sport, 'AND', out, add);
      return parseCombo(name, sels, base, sport, 'HTFT', out, add);
    case 'AND':
    case 'OR':
      return parseCombo(name, sels, base, sport, type, out, add);
    default:
      return unsupported('unknown');
  }
  if (!out.length) return unsupported('unknown');
  return finish(out, sport);
}

// En deportes de sets, "juegos/puntos/legs/rondas de un set" es el marcador de ese set.
const PER_SET_STATS = new Set(['games', 'points', 'legs', 'rounds']);
function normalizeSpec(spec, sport) {
  if (SET_SPORTS.has(sport) && /^s\d$/.test(spec.scope) && PER_SET_STATS.has(spec.stat)) return { ...spec, stat: 'score' };
  return spec;
}

function finish(out, sport) {
  return {
    spec: out[0].spec,
    outcomes: out.map((o) => {
      const spec = normalizeSpec(o.spec, sport);
      return { market: marketId(spec), spec, sel: o.sel, line: o.line, price: o.price, label: o.label };
    }),
  };
}

// "Local gana por exactamente 1 gol" → home:1 · "Local Gana por 3+" → home:3+
// "Local Gana por 1-2" → home:1-2 · "Ningún Equipo Gana por 6+" → none:6+ · "1-5" → any:1-5
export function marginOf(text) {
  const t = clean(text);
  if (/^empate$/.test(t)) return 'draw';
  const side = /^local/.test(t) ? 'home' : /^visitante/.test(t) ? 'away' : /^ningun/.test(t) ? 'none' : 'any';
  const range = t.match(/(\d+)\s*(?:-|a)\s*(\d+)/);
  if (range) return `${side}:${range[1]}-${range[2]}`;
  const plus = t.match(/(\d+)\s*(\+|o mas)/);
  if (plus) return `${side}:${plus[1]}+`;
  const exact = t.match(/(\d+)/);
  if (exact) return `${side}:${exact[1]}`;
  return null;
}

function parseCorrectScore(name, sels, base, sport, out, add) {
  const spec = { ...base, t: 'CS' };
  if (sport === 'tennis' && /puntuacion del set|apuesta de set|despues de 2 sets|marcador correcto del 1er set/.test(name)) {
    spec.stat = /puntuacion del set|1er set/.test(name) ? 'games' : 'score';
    if (/despues de 2 sets/.test(name)) spec.scope = 's1-2';
  }
  if (/en sets/.test(name)) spec.stat = 'score';
  if (/en etapas|set 1/.test(name) && sport === 'darts') spec.stat = 'legs';
  if (/marcador correcto del set/.test(name) && sport === 'volleyball') spec.stat = 'score';
  if (sport === 'esports' && /mapa/.test(name)) spec.stat = 'rounds';
  const listed = [];
  const parsed = sels.map((s) => {
    let t = clean(s.text).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    // "Visitante 6:0" (Apuesta Total): el marcador es del que gana.
    const prefixed = t.match(/^(local|visitante)\s+(\d+)\s*[-:]\s*(\d+)$/);
    if (prefixed) t = prefixed[1] === 'local' ? `${prefixed[2]}-${prefixed[3]}` : `${prefixed[3]}-${prefixed[2]}`;
    const single = scoreOf(t);
    if (single) {
      listed.push(single);
      return { s, sel: single };
    }
    const many = [...t.matchAll(/(\d+\+?)\s*[-:]\s*(\d+\+?)/g)].map((m) => `${m[1]}-${m[2]}`);
    if (many.length > 1) {
      listed.push(...many);
      return { s, sel: many.join(',') };
    }
    return { s, t };
  });
  for (const p of parsed) {
    if (p.sel) add(spec, p.sel, null, p.s);
    else if (/cualquier otro|otro resultado|cualquier otra/.test(p.t)) {
      const side = /^local/.test(p.t) ? 'home' : /^visitante/.test(p.t) ? 'away' : /^empate/.test(p.t) ? 'draw' : 'other';
      add(spec, `${side}!${listed.join(',')}`, null, p.s);
    } else if (/^empate con goles/.test(p.t)) add(spec, 'draw!0-0', null, p.s);
    else if (NONE.test(p.t)) add(spec, '0-0', null, p.s);
  }
  if (!out.length) return unsupported('unknown');
  return finish(out, sport);
}

// ---- Combinadas de la casa ----

// Una parte de una combinada: "Local", "Empate", "Más de 2.5", "Sí", "Local o Empate", "GG".
function partOf(text, kind, ctx) {
  const t = clean(text).trim();
  const { base, line } = ctx;
  if (/^(gg)$/.test(t)) return { spec: { ...base, t: 'BTTS' }, sel: 'yes' };
  if (/^(ng)$/.test(t)) return { spec: { ...base, t: 'BTTS' }, sel: 'no' };
  const dc = dcOf(t);
  if (dc) return { spec: { ...base, t: 'DC' }, sel: dc };
  const o = ouOf(t, line);
  if (o && Number.isFinite(o.line)) return { spec: { ...base, t: 'OU', team: ctx.ouTeam || null }, sel: o.sel, line: o.line };
  const yn = yesNo(t);
  if (yn && kind === 'btts') return { spec: { ...base, t: 'BTTS' }, sel: yn };
  const side = sideOf(t);
  if (side && side !== 'none') return { spec: { ...base, t: ctx.result || '1X2' }, sel: side };
  if (side === 'none') return { spec: { ...base, t: 'FIRST' }, sel: 'none' };
  return null;
}

function parseCombo(name, sels, base, sport, type, out, add) {
  const draws = !['basketball', 'american-football', 'tennis', 'volleyball', 'esports', 'mma', 'baseball'].includes(sport) || /fin tiempo reg/.test(name);
  const result = draws ? '1X2' : 'ML';
  const nameLine = numbers(name).filter((x) => !Number.isInteger(x)).pop();
  for (const s of sels) {
    const t = clean(s.text);
    let parts = null;
    if (type === 'HTFT') {
      const [ab, ou] = t.split(/\s+y\s+(?=mas|menos)/);
      const [a, b] = ab.split(/\s*\/\s*/);
      if (b == null) continue;
      const stat = base.stat;
      const pa = sideOf(a);
      const pb = sideOf(b);
      if (!pa || !pb) continue;
      parts = [
        { spec: { ...base, t: '1X2', scope: 'h1', stat }, sel: pa },
        { spec: { ...base, t: OT_SPORTS.has(sport) && stat === 'score' ? 'ML' : '1X2', scope: 'ft', stat }, sel: pb },
      ];
      if (ou) {
        const o = ouOf(ou, nameLine);
        if (!o || !Number.isFinite(o.line)) continue;
        parts.push({ spec: { ...base, t: 'OU' }, sel: o.sel, line: o.line });
      }
    } else if (/primer tiempo\/tiempo completo - doble/.test(name)) {
      const [a, b] = t.split(/\s*\/\s*(?=local|visitante|empate)/);
      parts = [
        { spec: { ...base, t: 'DC', scope: 'h1' }, sel: dcOf(a) },
        { spec: { ...base, t: 'DC' }, sel: dcOf(b) },
      ];
    } else if (/resultado primer tiempo o tiempo completo/.test(name)) {
      const side = sideOf(t);
      parts = [
        { spec: { ...base, t: '1X2', scope: 'h1' }, sel: side },
        { spec: { ...base, t: '1X2' }, sel: side },
      ];
    } else if (/doble resultado, set y partido/.test(name)) {
      const side = /^local/.test(t) ? 'home' : 'away';
      const other = side === 'home' ? 'away' : 'home';
      parts = [
        { spec: { ...base, t: 'ML', scope: 's1' }, sel: side },
        { spec: { ...base, t: 'ML' }, sel: /pierde/.test(t) ? other : side },
      ];
    } else if (/ambos jugadores ganan un set x resultado/.test(name)) {
      const [a, b] = t.split(/\s*\/\s*/);
      parts = [
        { spec: { ...base, t: 'BTTS' }, sel: yesNo(a) },
        { spec: { ...base, t: 'ML' }, sel: sideOf(b) },
      ];
    } else if (/gana & partido sobrepasa/.test(name)) {
      continue; // selección "Sí" sin equipo: no se puede saber de quién es
    } else {
      // "Local y Más 1.5", "Local & Más de 5.5", "Local / Sí", "Local o GG", "Empate o Más 2.5"
      const splitter = type === 'OR' ? /\s+o\s+(?=gg|ng|mas|menos|local|visitante|empate|1|2|x)/ : /\s*(?:\s&\s?|\sy\s|\s\/\s|&)\s*/;
      let pieces = t.split(splitter).map((x) => x.trim()).filter(Boolean);
      if (type === 'OR' && pieces.length === 1) pieces = t.split(/\s+o\s+/);
      if (pieces.length < 2) continue;
      // En "Local o Empate y Más 1.5" la primera parte es doble oportunidad.
      if (/doble oportunidad con/.test(name) || /doble oportunidad \//.test(name)) {
        const m = t.match(/^(.*?\s+o\s+.*?)\s+(?:y|&)\s+(.*)$/);
        if (m) pieces = [m[1], m[2]];
      }
      const ouTeam = /ganador & (local|visitante) total/.test(name) ? (/& local total/.test(name) ? 'home' : 'away') : null;
      const kinds = /ambos/.test(name) ? ['result', 'btts'] : ['result', 'total'];
      parts = pieces.map((p, i) => {
        const clean2 = ouTeam ? p.replace(/^(local|visitante)\s+/, (m) => (i > 0 ? '' : m)) : p;
        const kind = /ambos anotan y|ambos equipos anotan & total/.test(name) && i === 0 ? 'btts' : kinds[i] === 'btts' ? 'btts' : 'result';
        const ctx = { base, line: nameLine, result: /primer equipo en anotar/.test(name) && i === 0 ? 'FIRST' : result, ouTeam: i > 0 ? ouTeam : null };
        if (ctx.result === 'FIRST') {
          const side = sideOf(clean2);
          return side ? { spec: { ...base, t: 'FIRST' }, sel: side === 'draw' ? 'none' : side } : null;
        }
        return partOf(clean2, kind, ctx);
      });
      if (/fin tiempo reg|tiempo reg/.test(name)) parts = parts.map((p) => (p && ['1X2', 'OU', 'BTTS', 'FIRST'].includes(p.spec.t) ? { ...p, spec: { ...p.spec, scope: 'reg' } } : p));
      if (/periodo 1 - resultado & resultado/.test(name) && parts[0]) parts[0] = { ...parts[0], spec: { ...parts[0].spec, scope: 'p1' } };
      if (/ganador del partido & ganador del mapa/.test(name)) parts = parts.map((p, i) => p && { ...p, spec: { ...p.spec, t: 'ML', stat: 'score', scope: i === 0 ? 'ft' : scopeOf(name, sport) } });
      if (/ganador del set y total/.test(name)) parts = parts.map((p) => p && { ...p, spec: { ...p.spec, t: p.spec.t === '1X2' ? 'ML' : p.spec.t, stat: p.spec.t === 'OU' ? 'games' : 'score' } });
      if (sport === 'tennis' && /ganador y total de juegos/.test(name)) parts = parts.map((p) => p && { ...p, spec: { ...p.spec, t: p.spec.t === '1X2' ? 'ML' : p.spec.t, stat: p.spec.t === 'OU' ? 'games' : 'score' } });
      if (/ganador del mapa & total de rondas/.test(name)) parts = parts.map((p) => p && { ...p, spec: { ...p.spec, t: p.spec.t === '1X2' ? 'ML' : p.spec.t, stat: p.spec.t === 'OU' ? 'rounds' : 'score' } });
    }
    if (!parts || parts.some((p) => !p || !p.sel)) continue;
    if (/ganador del mapa & ganador de la primera mitad|ganador del mapa & ganador de la primera ronda/.test(name)) continue;
    const t2 = type === 'HTFT' ? 'AND' : type;
    add({ ...base, t: t2, scope: 'ft' }, encodeParts(parts.map((p) => ({ ...p, spec: normalizeSpec(p.spec, sport) }))), null, s);
  }
  if (!out.length) return unsupported('unknown');
  return finish(out, sport);
}

// Descripción corta del tipo para agrupar en la interfaz.
export function familyOf(spec) {
  if (!spec) return 'otro';
  if (spec.t === 'AND' || spec.t === 'OR') return 'combinado';
  if (spec.stat && spec.stat !== 'score') return spec.stat;
  if (spec.scope && spec.scope !== 'ft' && spec.scope !== 'reg') return 'periodo';
  return { '1X2': 'resultado', ML: 'resultado', DC: 'resultado', OU: 'total', OU3: 'total', HCP: 'handicap', HCP3: 'handicap', BTTS: 'ambos', CS: 'marcador', CNT: 'total', MRG: 'margen' }[spec.t] || 'otro';
}

// ---- Equipos al revés ----

// Si la casa lista los equipos al revés que nuestro partido, cada selección se
// da vuelta: local ↔ visita, hándicap con signo contrario, marcadores invertidos.
const SWAP_SIDE = { home: 'away', away: 'home', draw: 'draw', none: 'none', yes: 'yes', no: 'no' };
const SWAP_DC = { '1X': 'X2', X2: '1X', 12: '12' };
const swapScore = (s) => s.replace(/(\d+\+?)-(\d+\+?)/g, '$2-$1');

export function swapSpec(spec) {
  return { ...spec, team: spec.team ? SWAP_SIDE[spec.team] : spec.team };
}

export function swapSelection(spec, sel, line) {
  const t = spec.t;
  const neg = String(sel).startsWith('!') ? '!' : '';
  const s = neg ? String(sel).slice(1) : String(sel);
  const sp = swapSpec(spec);
  if (t === 'AND' || t === 'OR') {
    const parts = decodeParts(s).map((p) => {
      const x = swapSelection(p.spec, p.sel, p.line);
      return { spec: x.spec, sel: x.sel, line: x.line };
    });
    return { spec: sp, sel: neg + encodeParts(parts), line };
  }
  switch (t) {
    case 'DC':
      return { spec: sp, sel: SWAP_DC[s] || s, line };
    case 'HCP':
      return { spec: sp, sel: SWAP_SIDE[s] || s, line: line == null ? line : -line };
    case 'HCP3':
      // Línea del local → la nueva línea del local es la del antiguo visitante.
      return { spec: sp, sel: SWAP_SIDE[s] || s, line: line == null ? line : -line };
    case 'CS': {
      const bang = s.indexOf('!');
      if (bang >= 0) return { spec: sp, sel: `${SWAP_SIDE[s.slice(0, bang)] || s.slice(0, bang)}!${swapScore(s.slice(bang + 1))}`, line };
      return { spec: sp, sel: swapScore(s), line };
    }
    case 'GSEQ':
      return { spec: sp, sel: swapScore(s), line };
    case 'CSANY':
      return { spec: { ...sp, n: swapScore(String(spec.n)) }, sel: s, line };
    case 'MRG': {
      if (s === 'draw') return { spec: sp, sel: neg + s, line };
      const [side, r] = s.split(':');
      return { spec: sp, sel: neg + `${SWAP_SIDE[side] || side}:${r}`, line };
    }
    case 'SEQ':
      return { spec: sp, sel: s.replace(/[ha]/g, (c) => (c === 'h' ? 'a' : 'h')), line };
    case 'PMAX':
    case 'OE':
    case 'OU':
    case 'OU3':
    case 'CNT':
    case 'BTTS':
    case 'OT':
    case 'ALLPER':
    case 'FGT':
      return { spec: sp, sel: neg + s, line };
    default:
      return { spec: sp, sel: neg + (SWAP_SIDE[s] || s), line };
  }
}

// ---- Etiquetas ----

export const STAT_NAME = {
  corners: 'córners', cards: 'tarjetas', reds: 'tarjetas rojas', shots: 'remates', shots_on: 'tiros al arco', fouls: 'faltas',
  offsides: 'fueras de juego', throwins: 'saques de banda', goalkicks: 'saques de meta', passes: 'pases', tackles: 'entradas',
  woodwork: 'tiros al palo', pens: 'penales', pengoals: 'goles de penal', owngoals: 'autogoles', sog: 'tiros a puerta',
  pim: 'minutos de penalización', ppg: 'goles en superioridad', shg: 'goles en inferioridad', eng: 'goles a portería vacía',
  threes: 'triples', twos: 'tiros de 2', ftm: 'tiros libres', reb: 'rebotes', oreb: 'rebotes ofensivos', dreb: 'rebotes defensivos',
  ast: 'asistencias', tov: 'pérdidas', aces: 'aces', df: 'dobles faltas', acesdf: 'aces y dobles faltas', breaks: 'quiebres',
  tiebreaks: 'tie-breaks', games: 'juegos', points: 'puntos', legs: 'legs', rounds: 'rondas', '180s': '180s', tds: 'touchdowns',
  pass_tds: 'touchdowns de pase', rush_tds: 'touchdowns de carrera', pass_yds: 'yardas de pase', rush_yds: 'yardas de carrera',
  total_yds: 'yardas totales', hits: 'hits', scoreless_inn: 'entradas sin carreras', tied_inn: 'entradas empatadas',
  innings_won: 'entradas ganadas', both_scored_inn: 'entradas en que anotan ambos', duration: 'minutos de juego',
};
const ORDINAL = ['1.er', '2.º', '3.er', '4.º', '5.º', '6.º', '7.º', '8.º', '9.º'];
const ORDINAL_F = ['1.ª', '2.ª', '3.ª', '4.ª', '5.ª', '6.ª', '7.ª', '8.ª', '9.ª'];

export function scopeLabel(scope, sport) {
  if (!scope || scope === 'ft') return '';
  if (scope === 'reg') return 'tiempo reglamentario';
  if (scope === 'h1') return '1.er tiempo';
  if (scope === 'h2') return '2.º tiempo';
  if (scope === 's1-2') return 'dos primeros sets';
  let m = scope.match(/^p(\d)$/);
  if (m) return `${ORDINAL[m[1] - 1]} ${['basketball', 'american-football', 'waterpolo'].includes(sport) ? 'cuarto' : 'periodo'}`;
  m = scope.match(/^s(\d)$/);
  if (m) return `${ORDINAL[m[1] - 1]} ${sport === 'esports' ? 'mapa' : sport === 'table-tennis' ? 'juego' : 'set'}`;
  m = scope.match(/^i(\d)$/);
  if (m) return `${ORDINAL_F[m[1] - 1]} entrada`;
  m = scope.match(/^i1-(\d)$/);
  if (m) return `primeras ${m[1]} entradas`;
  m = scope.match(/^m(\d+)-(\d*)$/);
  if (m) return m[2] ? `minutos ${m[1]} a ${m[2]}` : `desde el minuto ${m[1]}`;
  return { halves: 'mitades', periods: 'periodos', innings: 'entradas', sets12: 'dos primeros sets' }[scope] || scope;
}

const unitOf = (sport) => ({ basketball: 'puntos', 'american-football': 'puntos', rugby: 'puntos', 'aussie-rules': 'puntos', baseball: 'carreras', tennis: 'sets', volleyball: 'sets', 'table-tennis': 'juegos', badminton: 'sets', darts: 'sets', esports: 'mapas' }[sport] || 'goles');

// Texto en español de una selección. names: { home, away } del partido.
export function labelOf(market, sel, line, sport, names = {}) {
  const spec = typeof market === 'string' ? parseMarketId(market) : market;
  if (!spec) return `${market} ${sel}`;
  const home = names.home || 'Local';
  const away = names.away || 'Visitante';
  const side = (x) => (x === 'home' ? home : x === 'away' ? away : x === 'draw' ? 'Empate' : x === 'none' ? 'Ninguno' : x);
  const neg = String(sel).startsWith('!');
  const s = neg ? String(sel).slice(1) : String(sel);
  const what = spec.stat && spec.stat !== 'score' ? STAT_NAME[spec.stat] || spec.stat : unitOf(sport);
  const scope = scopeLabel(spec.scope, sport);
  const sc = scope ? ` (${scope})` : '';
  const of = spec.team ? ` de ${side(spec.team)}` : '';
  const yes = (x) => (x === 'yes' ? 'Sí' : 'No');
  const fmt = (x) => (x > 0 ? `+${x}` : `${x}`);
  let text;
  switch (spec.t) {
    case 'AND':
    case 'OR': {
      const parts = decodeParts(s).map((p) => labelOf(p.spec, p.sel, p.line, sport, names));
      text = parts.join(spec.t === 'AND' ? ' y ' : ' o ');
      return neg ? `No: ${text}` : text;
    }
    case '1X2':
      if (spec.stat !== 'score' && spec.stat !== 'sets') text = s === 'draw' ? `Igual cantidad de ${what}` : `Más ${what}: ${side(s)}`;
      else text = s === 'draw' ? 'Empate' : `Gana ${side(s)}`;
      break;
    case 'ML':
      text = spec.stat !== 'score' ? `Más ${what}: ${side(s)}` : `Gana ${side(s)}`;
      break;
    case 'DC':
      text = { '1X': `${home} o empate`, X2: `Empate o ${away}`, 12: `${home} o ${away} (sin empate)` }[s];
      break;
    case 'OU':
      text = `${s === 'over' ? 'Más' : 'Menos'} de ${line} ${what}${of}`;
      break;
    case 'OU3':
      text = s === 'exact' ? `Exactamente ${line} ${what}${of}` : `${s === 'over' ? 'Más' : 'Menos'} de ${line} ${what}${of}`;
      break;
    case 'HCP':
      text = `${side(s)} ${fmt(s === 'home' ? line : -line)} (hándicap${spec.stat !== 'score' ? ` de ${what}` : ''})`;
      break;
    case 'HCP3':
      text = `Hándicap ${home} ${fmt(line)}: ${s === 'draw' ? 'empate' : side(s)}`;
      break;
    case 'BTTS':
      text = `${spec.stat === 'score' ? 'Ambos marcan' : `Ambos con ${what}`}${spec.n ? ` ${spec.n}+` : ''}: ${yes(s)}`;
      break;
    case 'OE':
      text = `Total de ${what}${of} ${s === 'odd' ? 'impar' : 'par'}`;
      break;
    case 'CNT':
      text = `Total de ${what}${of}: ${s}`;
      break;
    case 'CS': {
      const bang = s.indexOf('!');
      if (bang >= 0) {
        const kind = s.slice(0, bang);
        text = kind === 'other' ? 'Otro marcador' : kind === 'draw' ? 'Empate con goles' : `${side(kind)} gana con otro marcador`;
      } else text = `Marcador ${s.split(',').join(' o ')}`;
      if (spec.stat !== 'score') text += ` (${what})`;
      break;
    }
    case 'CSANY':
      text = `Algún set termina ${String(spec.n).replace(',', ' o ')}: ${yes(s)}`;
      break;
    case 'MRG': {
      if (s === 'draw') text = 'Empate';
      else {
        const [who, r] = s.split(':');
        text = who === 'none' ? `Nadie gana por ${r}` : who === 'any' ? `Alguien gana por ${r}` : `${side(who)} gana por ${r}`;
      }
      break;
    }
    case 'FIRST':
      text = `Primero en ${spec.stat === 'score' ? 'anotar' : `tener ${what}`}: ${side(s)}`;
      break;
    case 'LAST':
      text = `Último en ${spec.stat === 'score' ? 'anotar' : `tener ${what}`}: ${side(s)}`;
      break;
    case 'RACE':
      text = `Primero en llegar a ${spec.n || ''} ${what}: ${side(s)}`;
      break;
    case 'FGT':
      text = s === 'none' ? `Sin goles${of}` : `Primer gol${of} entre los minutos ${s.replace('-', ' y ')}`.replace(/ y $/, ' en adelante');
      break;
    case 'PMAX':
      text = `Con más ${what}: ${s === 'tie' ? 'empate' : scopeLabel(s, sport)}`;
      return text;
    case 'MAXPER':
      text = `Mejor ${spec.scope === 'halves' ? 'mitad' : 'periodo'}: ${side(s)}`;
      return text;
    case 'WINALL':
      text = `${spec.team ? side(spec.team) : 'Un equipo'} gana todos los ${spec.scope === 'halves' ? 'tiempos' : 'periodos'}: ${yes(s)}`;
      return text;
    case 'WINANY':
      text = `${side(spec.team)} gana algún ${spec.scope === 'halves' ? 'tiempo' : 'periodo'}: ${yes(s)}`;
      return text;
    case 'SCOREALL':
      text = `${spec.team ? `${side(spec.team)} anota` : 'Hay anotación'} en todos los ${spec.scope === 'halves' ? 'tiempos' : 'periodos'}: ${yes(s)}`;
      return text;
    case 'ALLPER':
      text = `${spec.n === 'under' ? 'Menos' : 'Más'} de ${line} en cada ${spec.scope === 'halves' ? 'tiempo' : 'periodo'}: ${yes(s)}`;
      return text;
    case 'CLEAN':
      text = `${spec.team ? side(spec.team) : 'Algún equipo'} gana sin recibir: ${yes(s)}`;
      break;
    case 'COMEBACK':
      text = `${side(spec.team)} gana tras ir perdiendo: ${yes(s)}`;
      break;
    case 'OT':
      text = `Hay prórroga: ${yes(s)}`;
      break;
    case 'SEQ':
      text = `Sets: ${s.split('').map((c) => (c === 'h' ? home : away)).join(', ')}`;
      break;
    case 'GSEQ':
      text = `${s} tras ${spec.n} juegos`;
      break;
    case 'SVC1':
      text = `Primer juego al saque de ${side(spec.team)}: lo gana ${side(s)}`;
      break;
    default:
      text = `${spec.t} ${s}`;
  }
  return `${neg ? 'No: ' : ''}${text}${sc}`;
}
