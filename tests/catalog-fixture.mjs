// Arma mercados de prueba a partir de tests/fixtures/mercados-betano.tsv (la
// lista de mercados de Betano por deporte): nombre del mercado y selecciones
// con los nombres reales de los equipos en lugar de "Local"/"Visitante".
import fs from 'node:fs';

export const SPORT_SLUGS = {
  Fútbol: 'football', Básquet: 'basketball', Tenis: 'tennis', 'Hockey sobre hielo': 'ice-hockey', Béisbol: 'baseball',
  'Fútbol americano': 'american-football', Vóley: 'volleyball', Balonmano: 'handball', 'Tenis de mesa': 'table-tennis',
  Esports: 'esports', MMA: 'mma', Dardos: 'darts', 'Rugby League': 'rugby', 'Rugby Union': 'rugby', Bádminton: 'badminton',
  Waterpolo: 'waterpolo', Futsal: 'futsal', Snooker: 'snooker', Ciclismo: 'cycling', Floorball: 'floorball', Críquet: 'cricket',
  'Motorsport · Fórmula 1': 'motorsport', 'Motorsport · MotoGP': 'motorsport', 'Motorsport · Moto2': 'motorsport',
};

export const HOME = 'Universitario';
export const AWAY = 'Alianza Lima';

const teams = (s) => s.replace(/\bLocal\b/g, HOME).replace(/\bVisitante\b/g, AWAY);

function fillName(name) {
  return name
    .replace('Resultado por minuto 00:00 - {X}', 'Resultado por minuto 00:00 - 29:59')
    .replace('Rango de resultados por minuto ({X})', 'Rango de resultados por minuto (00:00 - 29:59)')
    .replace('Goles cronometrados Más/Menos ({X})', 'Goles cronometrados Más/Menos (00:00 - 29:59)')
    .replace(/\(\{X\}\)/g, '(2.5)')
    .replace(/Set \{X\}/g, 'Set 1')
    .replace(/Mapa \{X\}/g, 'Mapa 1')
    .replace(/Cuarto \{X\}/g, 'Cuarto 2')
    .replace(/Inning \{X\}/g, 'Inning 5')
    .replace(/Run \{X\}/g, 'Run 3')
    .replace(/\s+\(y variantes\)/, '');
}

function selections(format, name) {
  const f = format.replace(/\s*…\s*\(\+\d+;.*\)$/, '').replace(/\s*\(\d+ variantes\)$/, '').replace(/, etc$/, '');
  if (/^—/.test(f)) {
    if (/hándicap/i.test(name)) return ['Local -1.5', 'Visitante +1.5'];
    if (/total|más\/menos/i.test(name)) return ['Más de 2.5', 'Menos 2.5'];
    return ['Local', 'Visitante'];
  }
  if (/^Más de N \/ Menos de N$/.test(f)) return ['Más de 2.5', 'Menos 2.5'];
  return f
    .split(' · ')
    .map((s) => s.replace(/^(1|X|2) \((Local|Empate|Visitante)\)$/, '$1').replace(/\{h\}/g, s.startsWith('Local') ? '-1.5' : '+1.5').replace(/Más de N/g, 'Más de 2.5').replace(/Menos N/g, 'Menos 2.5').replace(/Menos de N/g, 'Menos 2.5'))
    .filter(Boolean);
}

export function fixtureMarkets() {
  const rows = fs.readFileSync(new URL('./fixtures/mercados-betano.tsv', import.meta.url), 'utf8').trim().split('\n').slice(1);
  return rows.map((line, i) => {
    const [sportName, rawName, format] = line.split('\t');
    const name = teams(fillName(rawName));
    const sels = selections(format, rawName).map((s, j) => ({ name: teams(s), price: 1.5 + j * 0.25 }));
    return { row: i + 2, sport: SPORT_SLUGS[sportName], sportName, rawName, name, format, selections: sels };
  });
}
