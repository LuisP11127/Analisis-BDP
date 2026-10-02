// Dónde se guardan el historial y la red neuronal:
//  - github-web: en el repositorio, con el token pegado en ⚙ Ajustes. Funciona
//    en el celular y en la PC.
//  - github: en el repositorio, con el token guardado en la extensión.
//  - local: en este navegador (IndexedDB). Privado, pero solo en este dispositivo.
//  - lectura: el navegador no permite guardar; se leen los archivos publicados.
import * as ext from './ext.js';
import * as gh from './github.js';

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

async function idbWorks() {
  try {
    await idb('getAllKeys');
    return true;
  } catch {
    return false;
  }
}

// Elige dónde guardar. Devuelve { mode, info, tokenError }.
export async function init() {
  info = null;
  let tokenError = null;
  if (gh.hasToken()) {
    info = await gh.status();
    if (info.ok) {
      mode = 'github-web';
      return { mode, info };
    }
    tokenError = info.error;
    info = null;
  }
  if (ext.available()) {
    try {
      const st = await ext.call('github', 'status', {}, { timeout: 20000 });
      if (st.configured && st.ok) {
        mode = 'github';
        info = st;
        return { mode, info, tokenError };
      }
    } catch {
      // sin GitHub en la extensión: se guarda en el navegador
    }
  }
  mode = (await idbWorks()) ? 'local' : 'lectura';
  return { mode, info, tokenError };
}

export const getMode = () => mode;
export const getInfo = () => info;
export const canWrite = () => mode !== 'lectura';
export const isGithub = () => mode.startsWith('github');

// path: ruta lógica, p. ej. "data/historial/2026-10-02.json".
export async function read(path) {
  if (mode === 'github-web') {
    const file = await gh.getFile({ path: `docs/${path}` });
    return file ? JSON.parse(file.text) : null;
  }
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
  if (mode === 'github-web') return gh.putFile({ path: `docs/${path}`, text: JSON.stringify(value), message });
  if (mode === 'github') return ext.call('github', 'putFile', { path: `docs/${path}`, text: JSON.stringify(value), message }, { timeout: 60000 });
  if (mode === 'local') return idb('put', value, path);
  throw new Error('Este navegador no permite guardar datos');
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
