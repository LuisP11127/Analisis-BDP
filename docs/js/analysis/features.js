// Variables que recibe la red neuronal por cada selección analizada. Se
// guardan junto al resultado real para que la red aprenda de sus errores.
// Si se cambia esta lista hay que subir FEATURE_VERSION (las filas antiguas
// con otra versión se ignoran al entrenar).
import { clamp, logit } from '../util.js';
import { sideOf } from './markets.js';
import { sentiment } from './news.js';
import { marketGroupOf } from './picks.js';

// 2: noticias, tipo de mercado y simulación (las filas de la versión 1 se
// completan con ceros al entrenar: ver upgradeFeatures).
export const FEATURE_VERSION = 2;

export const FEATURES = [
  'logitBase', // probabilidad del análisis estadístico (escala logit)
  'dModel', // diferencia del modelo propio respecto de la base
  'dMarket', // diferencia del mercado (cuotas) respecto de la base
  'hasModel',
  'hasMarket',
  'lnOdds', // log de la cuota
  'quality', // cantidad de partidos con datos
  'sideStrength', // fuerza relativa del lado elegido
  'sideForm', // forma reciente del lado elegido
  'sideH2H',
  'sideMissing', // bajas del rival menos bajas propias
  'sideVotes', // votos de los usuarios de Sofascore
  'zLine', // distancia de la línea al total/margen esperado
  'mWinner',
  'mDraw',
  'mDC',
  'mOver',
  'mUnder',
  'mBttsYes',
  'mBttsNo',
  'mHcp',
  'sFootball',
  'sBasketball',
  'sTennis',
  'sGoals',
  'sPoints',
  'sOther',
  // Versión 2
  'newsAvail', // hay noticias cargadas (Flashscore, ESPN, FotMob)
  'sideNewsMentions', // menciones del lado elegido frente al rival
  'sideNewsInjuries', // noticias de lesiones/sanciones del rival menos las propias
  'sideNewsSentiment', // tono de las noticias (positivo − negativo)
  'newsInjuriesTotal', // noticias de lesiones de ambos (para totales)
  'fPeriod', // mercado de un periodo (mitad, cuarto, set...)
  'fStat', // mercado de estadísticas (córners, tarjetas...)
  'fScore', // marcador exacto / margen
  'fCombo', // combinado de la casa
  'fOther', // otros (primer gol, par/impar...)
  'viaSim', // probabilidad del modelo por simulación
  'qualityMarket', // confianza del modelo en ese mercado
];

const V1_LENGTH = 27;

// Filas antiguas: se completan las variables nuevas (sin noticias, mercado principal).
export function upgradeFeatures(x, fv) {
  if (fv === FEATURE_VERSION) return x;
  if (fv === 1 && x?.length === V1_LENGTH) {
    const extra = new Array(FEATURES.length - V1_LENGTH).fill(0);
    extra[extra.length - 1] = x[6]; // qualityMarket = calidad del modelo
    return [...x, ...extra];
  }
  return null;
}

function votesFor(c, side, votes) {
  if (!votes) return null;
  if (c.market === '1X2' && c.sel === 'draw') return votes.draw;
  if (c.market === 'DC' && c.sel === '12') return votes.home + votes.away;
  if (side === 0 || !['1X2', 'ML', 'DC', 'HCP'].includes(c.market)) return null;
  const base = side > 0 ? votes.home : votes.away;
  return c.market === 'DC' ? base + votes.draw : base;
}

// c: { market, sel, line, pModel, pMarket, pBase, price }
// ctx: { sport, cfg, model (salida de predict o null), details }
export function buildFeatures(c, ctx) {
  const side = sideOf(c.market, c.sel);
  const base = logit(c.pBase);
  const m = ctx.model;
  const d = ctx.details || {};
  const f = m?.form;

  let sideForm = 0;
  if (f?.home && f?.away) {
    const diff = ctx.cfg?.model === 'goals' && ctx.cfg?.draw ? (f.home.ppg - f.away.ppg) / 3 : f.home.winRate - f.away.winRate;
    sideForm = side * diff;
  }
  const h = d.h2h;
  const h2h = h ? (h.homeWins - h.awayWins) / (h.homeWins + h.awayWins + h.draws + 2) : 0;
  const miss = d.missing ? (d.missing.away.length - d.missing.home.length) / 5 : 0;
  const pv = votesFor(c, side, d.votes);
  const votes = pv == null ? 0 : clamp(logit(clamp(pv, 0.02, 0.98)) / 3, -2, 2);

  let zLine = 0;
  const e = m?.expected;
  if (e && c.market === 'OU') zLine = ((e.total - c.line) / e.sdTotal) * (c.sel === 'over' ? 1 : -1);
  if (e && c.market === 'HCP') zLine = ((e.margin + c.line) / e.sdMargin) * (c.sel === 'home' ? 1 : -1);

  const sport = ctx.sport;
  const model = ctx.cfg?.model;
  const news = d.news || null;
  const nh = news?.home;
  const na = news?.away;
  const group = marketGroupOf(c.family);
  const x = [
    clamp(base, -6, 6),
    c.pModel != null ? clamp(logit(c.pModel) - base, -4, 4) : 0,
    c.pMarket != null ? clamp(logit(c.pMarket) - base, -4, 4) : 0,
    c.pModel != null ? 1 : 0,
    c.pMarket != null ? 1 : 0,
    clamp(Math.log(c.price || 1), 0, 3),
    m?.quality ?? 0,
    side * clamp(m?.strength ?? 0, -3, 3),
    sideForm,
    side * h2h,
    side * clamp(miss, -2, 2),
    votes,
    clamp(zLine, -4, 4),
    (c.market === '1X2' && c.sel !== 'draw') || c.market === 'ML' ? 1 : 0,
    c.market === '1X2' && c.sel === 'draw' ? 1 : 0,
    c.market === 'DC' ? 1 : 0,
    c.market === 'OU' && c.sel === 'over' ? 1 : 0,
    c.market === 'OU' && c.sel === 'under' ? 1 : 0,
    c.market === 'BTTS' && c.sel === 'yes' ? 1 : 0,
    c.market === 'BTTS' && c.sel === 'no' ? 1 : 0,
    c.market === 'HCP' ? 1 : 0,
    sport === 'football' ? 1 : 0,
    sport === 'basketball' ? 1 : 0,
    sport === 'tennis' ? 1 : 0,
    model === 'goals' && sport !== 'football' ? 1 : 0,
    model === 'points' && sport !== 'basketball' ? 1 : 0,
    model !== 'goals' && model !== 'points' && sport !== 'tennis' ? 1 : 0,
    news ? 1 : 0,
    news ? side * clamp(Math.log1p(nh.n) - Math.log1p(na.n), -3, 3) : 0,
    news ? side * clamp((na.injuries - nh.injuries) / 2, -2, 2) : 0,
    news ? side * (sentiment(nh) - sentiment(na)) : 0,
    news ? clamp(Math.log1p(nh.injuries + na.injuries), 0, 3) : 0,
    group === 'periodos' ? 1 : 0,
    group === 'estadisticas' ? 1 : 0,
    group === 'marcador' ? 1 : 0,
    group === 'combinados' ? 1 : 0,
    group === 'otros' ? 1 : 0,
    c.via === 'simulación' ? 1 : 0,
    ctx.quality ?? m?.quality ?? 0,
  ];
  return x.map((v) => Math.round(v * 1000) / 1000);
}
