// Dónde se guardan el historial y la red neuronal:
//  - github: en el repositorio (vía la extensión, con su token). Se ve desde
//    cualquier dispositivo, incluido el celular.
//  - local: en este navegador (IndexedDB). Privado, pero solo en esta PC.
//  - lectura: sin extensión; se leen los archivos publicados en GitHub Pages.
import * as ext from './ext.js';

let mode = 'lectura';
let info = null;

const DB = 'analisis-bdp';
const STORE = 'archivos';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(method, ...args) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, method === 'get' || method === 'getAllKeys' ? 'readonly' : 'readwrite');
    const req = tx.objectStore(STORE)[method](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function init() {
  info = null;
  if (!ext.available()) {
    mode = 'lectura';
    return { mode };
  }
  try {
    info = await ext.call('github', 'status', {}, { timeout: 20000 });
    mode = info.configured && info.ok ? 'github' : 'local';
  } catch {
    mode = 'local';
  }
  return { mode, info };
}

export const getMode = () => mode;
export const getInfo = () => info;
export const canWrite = () => mode !== 'lectura';

// path: ruta lógica, p. ej. "data/historial/2026-10-02.json".
export async function read(path) {
  if (mode === 'github') {
    const file = await ext.call('github', 'getFile', { path: `docs/${path}` }, { timeout: 60000 });
    return file ? JSON.parse(file.text) : null;
  }
  if (mode === 'local') return (await idb('get', path)) ?? null;
  try {
    const resp = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

export async function write(path, value, message) {
  if (mode === 'github') return ext.call('github', 'putFile', { path: `docs/${path}`, text: JSON.stringify(value), message }, { timeout: 60000 });
  if (mode === 'local') return idb('put', value, path);
  throw new Error('Sin extensión no se puede guardar');
}

// Rutas guardadas en este navegador (para subirlas a GitHub).
export async function localPaths() {
  try {
    return await idb('getAllKeys');
  } catch {
    return [];
  }
}

export const readLocal = (path) => idb('get', path);
