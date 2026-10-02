// Deportes de Sofascore y el modelo estadístico que usa cada uno.
//  - goals: goles/carreras con distribución de Poisson.
//  - points: puntos con distribución normal (básquet, fútbol americano...).
//  - tennis: ranking, forma y H2H.
//  - generic: forma reciente y H2H.
// draw: el resultado 1X2 admite empate. ha: ventaja de local.

export const SPORTS = [
  { slug: 'football', name: 'Fútbol', icon: '⚽', model: 'goals', draw: true, dc: true, btts: true, lines: [0.5, 1.5, 2.5, 3.5, 4.5], ha: 1.2, unit: 'goles' },
  { slug: 'basketball', name: 'Básquet', icon: '🏀', model: 'points', ha: 2.5, sdMargin: 0.055, sdTotal: 0.08, unit: 'puntos' },
  { slug: 'tennis', name: 'Tenis', icon: '🎾', model: 'tennis', neutral: true, unit: 'sets' },
  { slug: 'baseball', name: 'Béisbol', icon: '⚾', model: 'goals', lines: [7.5, 8.5, 9.5], ha: 1.04, unit: 'carreras' },
  { slug: 'ice-hockey', name: 'Hockey', icon: '🏒', model: 'goals', lines: [4.5, 5.5, 6.5], ha: 1.08, unit: 'goles' },
  { slug: 'american-football', name: 'Fútbol americano', icon: '🏈', model: 'points', ha: 1.8, sdMarginAbs: 13.5, sdTotalAbs: 13, unit: 'puntos' },
  { slug: 'volleyball', name: 'Vóley', icon: '🏐', model: 'generic', unit: 'sets' },
  { slug: 'handball', name: 'Balonmano', icon: '🤾', model: 'goals', draw: true, dc: true, lines: [], ha: 1.08, unit: 'goles' },
  { slug: 'futsal', name: 'Futsal', icon: '🥅', model: 'goals', draw: true, dc: true, btts: true, lines: [4.5, 5.5, 6.5], ha: 1.08, unit: 'goles' },
  { slug: 'table-tennis', name: 'Tenis de mesa', icon: '🏓', model: 'generic', neutral: true, unit: 'sets' },
  { slug: 'esports', name: 'eSports', icon: '🎮', model: 'generic', neutral: true, unit: 'mapas' },
  { slug: 'rugby', name: 'Rugby', icon: '🏉', model: 'points', ha: 3, sdMarginAbs: 14, sdTotalAbs: 14, unit: 'puntos' },
  { slug: 'cricket', name: 'Críquet', icon: '🏏', model: 'generic', unit: 'carreras' },
  { slug: 'mma', name: 'MMA', icon: '🥊', model: 'generic', neutral: true, unit: 'rounds' },
  { slug: 'darts', name: 'Dardos', icon: '🎯', model: 'generic', neutral: true, unit: 'sets' },
  { slug: 'snooker', name: 'Snooker', icon: '🎱', model: 'generic', neutral: true, unit: 'frames' },
  { slug: 'badminton', name: 'Bádminton', icon: '🏸', model: 'generic', neutral: true, unit: 'sets' },
  { slug: 'waterpolo', name: 'Waterpolo', icon: '🤽', model: 'goals', draw: true, dc: true, lines: [], ha: 1.08, unit: 'goles' },
  { slug: 'beach-volley', name: 'Vóley playa', icon: '🏖️', model: 'generic', neutral: true, unit: 'sets' },
  { slug: 'aussie-rules', name: 'Fútbol australiano', icon: '🏉', model: 'points', ha: 6, sdMarginAbs: 30, sdTotalAbs: 25, unit: 'puntos' },
  { slug: 'floorball', name: 'Floorball', icon: '🏑', model: 'goals', draw: true, dc: true, lines: [], ha: 1.05, unit: 'goles' },
  { slug: 'bandy', name: 'Bandy', icon: '🏑', model: 'goals', draw: true, dc: true, lines: [], ha: 1.05, unit: 'goles' },
];

export const sportBySlug = Object.fromEntries(SPORTS.map((s) => [s.slug, s]));

export const sportOf = (slug) => sportBySlug[slug] || { slug, name: slug, icon: '🏅', model: 'generic', unit: 'puntos' };
