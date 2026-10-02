// Comunicación con la extensión "Análisis BDP - Conector" a través de
// window.postMessage (el puente es extension/bridge.js).
const pending = new Map();
let seq = 0;
let readyInfo = null;
const readyWaiters = [];

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.bdp === 'ready') {
      readyInfo = { version: msg.version };
      readyWaiters.splice(0).forEach((resolve) => resolve(readyInfo));
    } else if (msg.bdp === 'response' && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      msg.ok ? resolve(msg.data) : reject(new Error(msg.error || 'Error de la extensión'));
    }
  });
}

// Espera a que la extensión responda. Devuelve { version } o null.
export function detect(timeout = 1500) {
  if (readyInfo) return Promise.resolve(readyInfo);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(readyInfo), timeout);
    readyWaiters.push((info) => {
      clearTimeout(timer);
      resolve(info);
    });
    window.postMessage({ bdp: 'request', action: 'ping' }, window.location.origin);
  });
}

export const available = () => Boolean(readyInfo);

export function request(action, params = {}, { timeout = 120000 } = {}) {
  if (!readyInfo) return Promise.reject(new Error('La extensión no está instalada o no respondió'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('La extensión tardó demasiado en responder'));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ bdp: 'request', id, action, params }, window.location.origin);
  });
}

export const call = (source, fn, args = {}, opts) => request('call', { source, fn, args }, opts);
