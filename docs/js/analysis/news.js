// Noticias (Flashscore, ESPN, FotMob) → señales de cada equipo para la red
// neuronal: cuántas noticias lo mencionan, si hablan de lesiones o sanciones
// y si el tono es positivo o negativo. Solo las usa la red neuronal; el
// análisis estadístico no mira noticias.
import { basicNorm } from './matching.js';

const NEWS_HOURS = 72; // noticias de los últimos 3 días antes del partido

// Palabras de equipos que no sirven para reconocerlos solas.
const GENERIC = new Set(
  'club deportivo deportes sporting real atletico athletic united city town rovers wanderers fc cf sc ac afc cd ca de del la el los las the san santa saint union universidad universitario nacional national inter international olympique olympic racing borussia dynamo dinamo fk sk sv women femenino reserves sub u21 u23 ii b'.split(
    ' ',
  ),
);

const INJURY = /\b(lesion\w*|lesionad\w*|baja[s]?|duda[s]?|descartad\w*|sancion\w*|suspendid\w*|expulsad\w*|molestias|rotura|esguince|operad\w*|no estara|se pierde|injur\w*|injured|ruled out|out for|suspended|doubtful|hamstring)\b/;
const POSITIVE = /\b(gan[aóo]\w*|victoria\w*|triunf\w*|golea\w*|invict\w*|lider\w*|racha positiva|remonta\w*|clasific\w*|recupera\w*|vuelve|regresa|alta medica|confirmad\w*|wins?|won|victory|unbeaten|returns?|back in)\b/;
const NEGATIVE = /\b(derrota\w*|perd[ií]\w*|pierde\w*|crisis|cesad\w*|destituid\w*|despid\w*|dimite|dimision|sin ganar|racha negativa|goleado|eliminad\w*|polemica|conflicto|deuda\w*|loses?|lost|defeat|sacked|crisis)\b/;

// Frases con las que se reconoce a un equipo/jugador en un texto normalizado.
export function teamKeys(name = '') {
  const full = basicNorm(name).replace(/\s+/g, ' ').trim();
  if (!full) return [];
  const keys = new Set([full]);
  const tokens = full.split(' ').filter((t) => t.length >= 4 && !GENERIC.has(t) && !/^\d+$/.test(t));
  // Tenistas "Sinner J." → "sinner"; equipos: la palabra más distintiva (la más larga).
  if (tokens.length) keys.add(tokens.sort((a, b) => b.length - a.length)[0]);
  return [...keys].filter((k) => k.length >= 4);
}

const textOf = (a) => ` ${basicNorm(`${a.title || ''} ${a.summary || ''}`)} `;
// Texto normalizado de cada noticia (una sola vez para todos los partidos).
export const prepareNews = (articles = []) => articles.map((a) => (a._text ? a : { ...a, _text: textOf(a) }));

const keyRegex = (k) => new RegExp(`[^a-z0-9]${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`);
const inWindow = (a, before) => {
  const t = typeof a.published === 'number' ? a.published : Date.parse(a.published);
  return !(Number.isFinite(t) && Number.isFinite(before) && (t > before || before - t > NEWS_HOURS * 3600000));
};
// Posición de la primera mención del equipo en el texto (-1 si no aparece).
function firstMention(text, regexes) {
  let pos = -1;
  for (const re of regexes) {
    const m = re.exec(text);
    if (m && (pos < 0 || m.index < pos)) pos = m.index;
  }
  return pos;
}

// Señales de un partido: { home, away, total } o null si no hay noticias.
// Una noticia cuenta como mención para cada equipo que nombre; lesiones y
// tono se atribuyen al protagonista (el equipo que se nombra primero).
export function newsFeatures(ev, articles) {
  if (!articles?.length) return null;
  const empty = () => ({ n: 0, injuries: 0, pos: 0, neg: 0 });
  const out = { home: empty(), away: empty(), total: articles.length };
  const res = { home: teamKeys(ev.home?.name).map(keyRegex), away: teamKeys(ev.away?.name).map(keyRegex) };
  for (const a of articles) {
    if (!inWindow(a, ev.start)) continue;
    const text = a._text || textOf(a);
    const pos = { home: res.home.length ? firstMention(text, res.home) : -1, away: res.away.length ? firstMention(text, res.away) : -1 };
    const named = ['home', 'away'].filter((s) => pos[s] >= 0);
    if (!named.length) continue;
    for (const s of named) out[s].n++;
    const main = named.length === 1 ? named[0] : pos.home <= pos.away ? 'home' : 'away';
    if (INJURY.test(text)) out[main].injuries++;
    if (POSITIVE.test(text)) out[main].pos++;
    if (NEGATIVE.test(text)) out[main].neg++;
  }
  return out;
}

export const sentiment = (s) => (s ? (s.pos - s.neg) / (s.pos + s.neg + 1) : 0);

// Formato compacto para publicar: [fuente, título, resumen, publicada (s), deporte].
export const compactNews = (a) => [a.source, a.title, String(a.summary || '').slice(0, 240), Math.round(Date.parse(a.published) / 1000) || null, a.sport || null];
export const expandNews = ([source, title, summary, published, sport]) => ({ source, title, summary, published: published ? published * 1000 : null, sport });
