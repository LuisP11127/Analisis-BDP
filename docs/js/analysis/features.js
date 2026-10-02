// Variables que recibe la red neuronal por cada selección analizada. Se
// guardan junto al resultado real para que la red aprenda de sus errores.
// Si se cambia esta lista hay que subir FEATURE_VERSION (las filas antiguas
// con otra versión se ignoran al entrenar).
import { clamp, logit } from '../util.js';
import { sideOf } from './markets.js';

export const FEATURE_VERSION = 1;

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
];

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
  ];
  return x.map((v) => Math.round(v * 1000) / 1000);
}
