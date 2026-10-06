import assert from 'node:assert/strict';
import test from 'node:test';
import { Corrector, MIN_SAMPLES } from '../docs/js/analysis/neural.js';
import { logit, rng, sigmoid } from '../docs/js/util.js';

const INPUTS = 6;

// Datos donde la probabilidad base está mal calibrada según una variable:
// la verdadera es sigmoid(logit(base) + 1.2 * x0).
function dataset(n, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const x = Array.from({ length: INPUTS }, () => r() * 2 - 1);
    const pBase = 0.35 + 0.5 * r();
    const pTrue = sigmoid(logit(pBase) + 1.2 * x[0]);
    return { x, pBase, y: r() < pTrue ? 1 : 0, start: i };
  });
}

test('sin entrenar devuelve la probabilidad base', () => {
  const net = new Corrector({ inputs: INPUTS });
  assert.equal(net.predict([0, 0, 0, 0, 0, 0], 0.7), 0.7);
});

test('con pocos resultados no corrige', () => {
  const net = new Corrector({ inputs: INPUTS });
  const meta = net.train(dataset(MIN_SAMPLES - 1, 1));
  assert.equal(net.trained, false);
  assert.match(meta.reason, /Faltan resultados/);
});

test('aprende a corregir un error sistemático y mejora en datos nuevos', () => {
  const net = new Corrector({ inputs: INPUTS });
  const meta = net.train(dataset(1500, 2));
  assert.equal(net.trained, true);
  assert.ok(meta.nnLoss < meta.baseLoss, `${meta.nnLoss} >= ${meta.baseLoss}`);
  // En datos que no vio, la corrección va en la dirección correcta.
  const up = net.predict([0.9, 0, 0, 0, 0, 0], 0.5);
  const down = net.predict([-0.9, 0, 0, 0, 0, 0], 0.5);
  assert.ok(up > 0.6 && down < 0.4, `up ${up} down ${down}`);
  // Guardar y cargar da lo mismo.
  const copy = Corrector.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
  assert.ok(Math.abs(copy.predict([0.9, 0, 0, 0, 0, 0], 0.5) - up) < 1e-3);
});

test('si no hay nada que corregir, no empeora', () => {
  const r = rng(3);
  const rows = Array.from({ length: 600 }, (_, i) => {
    const pBase = 0.3 + 0.6 * r();
    return { x: Array.from({ length: INPUTS }, () => r()), pBase, y: r() < pBase ? 1 : 0, start: i };
  });
  const net = new Corrector({ inputs: INPUTS });
  const meta = net.train(rows);
  assert.ok(meta.nnLoss <= meta.baseLoss + 1e-9);
});

test('las filas pendientes (sin resultado) no se usan para entrenar', async () => {
  const { isResult } = await import('../docs/js/analysis/neural.js');
  assert.equal(isResult(null), false, 'null >= 0 es verdadero en JavaScript: no debe contar');
  assert.equal(isResult(undefined), false);
  assert.equal(isResult(-1), false);
  assert.equal(isResult(0), true);
  assert.equal(isResult(0.75), true);
  const net = new Corrector({ inputs: 3 });
  const rows = Array.from({ length: 300 }, (_, i) => ({ x: [i % 3, 1, 0], pBase: 0.6, y: null, start: i }));
  const meta = net.train(rows);
  assert.equal(meta.samples, 0);
  assert.equal(net.trained, false);
});
