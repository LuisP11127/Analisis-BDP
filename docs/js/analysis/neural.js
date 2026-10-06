// Red neuronal que aprende de los errores del análisis estadístico.
//
// No predice desde cero: toma la probabilidad del análisis estadístico y le
// suma una corrección (en escala logit) que calcula una red pequeña
// (entrada -> 10 neuronas tanh -> 1). Al inicio la corrección es 0, así que
// la red da lo mismo que el análisis estadístico. Cada vez que se actualizan
// los resultados se reentrena con todas las selecciones ya resueltas; solo
// aplica la corrección si mejora en partidos que no usó para entrenar.
import { logit, rng, sigmoid } from '../util.js';
import { FEATURE_VERSION } from './features.js';

// Resultado real de una fila: 1 ganó, 0 perdió, 0.75 / 0.25 medias apuestas.
// Ojo: null >= 0 es verdadero en JavaScript; las pendientes (null) no cuentan.
export const isResult = (y) => typeof y === 'number' && y >= 0 && y <= 1;

export const MIN_SAMPLES = 200; // resultados mínimos para empezar a corregir
const MIN_GAIN = 0.01; // la corrección debe bajar el error al menos un 1 %

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function bce(p, y) {
  const q = Math.min(1 - 1e-7, Math.max(1e-7, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

export class Corrector {
  constructor({ inputs, hidden = 10, seed = 7 } = {}) {
    this.inputs = inputs;
    this.hidden = hidden;
    this.seed = seed;
    this.reset();
    this.mean = new Array(inputs).fill(0);
    this.std = new Array(inputs).fill(1);
    this.scale = 0;
    this.trained = false;
    this.meta = {};
  }

  reset() {
    const r = rng(this.seed);
    const randn = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    this.W1 = Array.from({ length: this.hidden }, () => Array.from({ length: this.inputs }, () => randn() / Math.sqrt(this.inputs)));
    this.b1 = new Array(this.hidden).fill(0);
    this.W2 = new Array(this.hidden).fill(0); // salida en 0: sin corrección al inicio
    this.b2 = 0;
  }

  norm(x) {
    return x.map((v, i) => (v - this.mean[i]) / this.std[i]);
  }

  forward(xn) {
    const h = this.W1.map((w, j) => Math.tanh(dot(w, xn) + this.b1[j]));
    return { h, out: dot(this.W2, h) + this.b2 };
  }

  correction(x) {
    if (!this.trained || !x || x.length !== this.inputs) return 0;
    return this.scale * this.forward(this.norm(x)).out;
  }

  predict(x, pBase) {
    return sigmoid(logit(pBase) + this.correction(x));
  }

  // Pérdida media (log loss) con la corrección multiplicada por `scale`.
  loss(rows, scale = 1) {
    let s = 0;
    for (const r of rows) s += bce(sigmoid(r.b + scale * this.forward(r.xn).out), r.y);
    return rows.length ? s / rows.length : 0;
  }

  // Descenso de gradiente (Adam) sobre todas las filas a la vez.
  fit(rows, { epochs, lr, l2, val = null, patience = 40 }) {
    const H = this.hidden;
    const I = this.inputs;
    const state = { mW1: this.W1.map((r) => r.map(() => 0)), vW1: this.W1.map((r) => r.map(() => 0)), mb1: new Array(H).fill(0), vb1: new Array(H).fill(0), mW2: new Array(H).fill(0), vW2: new Array(H).fill(0), mb2: 0, vb2: 0 };
    const b1 = 0.9;
    const b2 = 0.999;
    const eps = 1e-8;
    const snapshot = () => ({ W1: this.W1.map((r) => r.slice()), b1: this.b1.slice(), W2: this.W2.slice(), b2: this.b2 });
    let best = val ? { loss: this.loss(val), params: snapshot(), epoch: 0 } : null;
    const N = rows.length;
    let epoch = 0;
    for (epoch = 1; epoch <= epochs; epoch++) {
      const gW1 = this.W1.map((r) => r.map(() => 0));
      const gb1 = new Array(H).fill(0);
      const gW2 = new Array(H).fill(0);
      let gb2 = 0;
      for (const r of rows) {
        const { h, out } = this.forward(r.xn);
        const dz = (sigmoid(r.b + out) - r.y) / N;
        gb2 += dz;
        for (let j = 0; j < H; j++) {
          gW2[j] += dz * h[j];
          const dpre = dz * this.W2[j] * (1 - h[j] * h[j]);
          if (dpre === 0) continue;
          gb1[j] += dpre;
          const row = gW1[j];
          for (let k = 0; k < I; k++) row[k] += dpre * r.xn[k];
        }
      }
      const t = epoch;
      const step = (param, grad, m, v) => {
        const mm = b1 * m + (1 - b1) * grad;
        const vv = b2 * v + (1 - b2) * grad * grad;
        const upd = (lr * (mm / (1 - b1 ** t))) / (Math.sqrt(vv / (1 - b2 ** t)) + eps);
        return [param - upd, mm, vv];
      };
      for (let j = 0; j < H; j++) {
        for (let k = 0; k < I; k++) {
          const g = gW1[j][k] + 2 * l2 * this.W1[j][k];
          [this.W1[j][k], state.mW1[j][k], state.vW1[j][k]] = step(this.W1[j][k], g, state.mW1[j][k], state.vW1[j][k]);
        }
        [this.b1[j], state.mb1[j], state.vb1[j]] = step(this.b1[j], gb1[j], state.mb1[j], state.vb1[j]);
        [this.W2[j], state.mW2[j], state.vW2[j]] = step(this.W2[j], gW2[j] + 2 * l2 * this.W2[j], state.mW2[j], state.vW2[j]);
      }
      [this.b2, state.mb2, state.vb2] = step(this.b2, gb2, state.mb2, state.vb2);
      if (val) {
        const l = this.loss(val);
        if (l < best.loss - 1e-6) best = { loss: l, params: snapshot(), epoch };
        else if (epoch - best.epoch > patience) break;
      }
    }
    if (best) Object.assign(this, best.params);
    return best ? best.epoch : epoch - 1;
  }

  // rows: [{ x, pBase, y (0/1), start }]. Devuelve métricas del entrenamiento.
  train(rows, { epochs = 300, lr = 0.01, l2 = 0.003, valFraction = 0.2 } = {}) {
    const data = rows
      .filter((r) => isResult(r.y) && r.x?.length === this.inputs && r.pBase > 0 && r.pBase < 1)
      .sort((a, b) => (a.start || 0) - (b.start || 0))
      .slice(-15000);
    if (data.length < MIN_SAMPLES) {
      this.trained = false;
      this.scale = 0;
      this.meta = { trainedAt: new Date().toISOString(), samples: data.length, reason: `Faltan resultados: ${data.length} de ${MIN_SAMPLES}` };
      return this.meta;
    }
    // Normalización con los datos de entrenamiento.
    this.mean = new Array(this.inputs).fill(0);
    this.std = new Array(this.inputs).fill(0);
    for (const r of data) r.x.forEach((v, i) => (this.mean[i] += v / data.length));
    for (const r of data) r.x.forEach((v, i) => (this.std[i] += (v - this.mean[i]) ** 2 / data.length));
    this.std = this.std.map((v) => Math.max(Math.sqrt(v), 1e-3));
    const prep = (r) => ({ xn: this.norm(r.x), b: logit(r.pBase), y: r.y });

    // 1) Validación cronológica: entrena con lo antiguo, mide en lo reciente.
    const nVal = Math.max(20, Math.round(data.length * valFraction));
    const trainSet = data.slice(0, -nVal).map(prep);
    const valSet = data.slice(-nVal).map(prep);
    this.reset();
    const bestEpoch = Math.max(5, this.fit(trainSet, { epochs, lr, l2, val: valSet }));
    const baseLoss = this.loss(valSet, 0);
    let bestScale = 0;
    let bestLoss = baseLoss;
    for (const s of [0.25, 0.5, 0.75, 1]) {
      const l = this.loss(valSet, s);
      if (l < bestLoss - 1e-6) [bestScale, bestLoss] = [s, l];
    }
    if (bestLoss > baseLoss * (1 - MIN_GAIN)) [bestScale, bestLoss] = [0, baseLoss]; // mejora insuficiente
    const metrics = {
      baseLoss,
      nnLoss: bestLoss,
      baseAccuracy: accuracy(valSet, (r) => sigmoid(r.b)),
      nnAccuracy: accuracy(valSet, (r) => sigmoid(r.b + bestScale * this.forward(r.xn).out)),
      validation: valSet.length,
    };

    // 2) Modelo final con todos los datos (incluidos los más recientes).
    this.reset();
    this.fit(data.map(prep), { epochs: bestEpoch, lr, l2 });
    this.scale = bestScale;
    this.trained = bestScale > 0;
    this.meta = { trainedAt: new Date().toISOString(), samples: data.length, epochs: bestEpoch, scale: bestScale, ...roundAll(metrics) };
    return this.meta;
  }

  toJSON() {
    const r = (v) => Math.round(v * 1e5) / 1e5;
    return {
      version: 1,
      featureVersion: FEATURE_VERSION,
      inputs: this.inputs,
      hidden: this.hidden,
      W1: this.W1.map((row) => row.map(r)),
      b1: this.b1.map(r),
      W2: this.W2.map(r),
      b2: r(this.b2),
      mean: this.mean.map(r),
      std: this.std.map(r),
      scale: this.scale,
      trained: this.trained,
      meta: this.meta,
    };
  }

  static fromJSON(o) {
    const net = new Corrector({ inputs: o.inputs, hidden: o.hidden });
    Object.assign(net, { W1: o.W1, b1: o.b1, W2: o.W2, b2: o.b2, mean: o.mean, std: o.std, scale: o.scale, trained: o.trained, meta: o.meta || {} });
    if (o.featureVersion !== FEATURE_VERSION) net.trained = false; // variables distintas: no aplicar
    return net;
  }
}

function accuracy(rows, prob) {
  if (!rows.length) return null;
  return rows.filter((r) => (prob(r) >= 0.5 ? 1 : 0) === r.y).length / rows.length;
}

function roundAll(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v]));
}
