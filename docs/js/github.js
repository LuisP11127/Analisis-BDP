// Guardar en GitHub desde la página (celular o PC) con un token pegado en
// Ajustes. El token se guarda solo en este navegador (localStorage) y se usa
// únicamente para leer y escribir archivos JSON dentro de docs/data/.
const API = 'https://api.github.com';
const KEY = 'bdp:github';
const DEFAULTS = { repo: 'LuisP11127/Analisis-BDP', branch: 'main', token: '' };
const WRITABLE = /^docs\/data\/[\w\-./]+\.json$/;

export function getConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const hasToken = () => Boolean(getConfig().token);

export function setConfig({ token, repo, branch } = {}) {
  const current = getConfig();
  const next = {
    token: token === undefined ? current.token : String(token).trim(),
    repo: (repo || current.repo).trim(),
    branch: (branch || current.branch).trim(),
  };
  try {
    if (next.token) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    throw new Error('Este navegador no permite guardar el token (¿modo incógnito?)');
  }
  return next;
}

export const forget = () => setConfig({ token: '' });

function gh(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const { token } = getConfig();
  return fetch(API + path, {
    method,
    cache: 'no-store',
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// { repo, branch, configured, ok, error }
export async function status() {
  const cfg = getConfig();
  const base = { repo: cfg.repo, branch: cfg.branch, configured: Boolean(cfg.token) };
  if (!cfg.token) return base;
  let r;
  try {
    r = await gh(`/repos/${cfg.repo}`);
  } catch {
    return { ...base, ok: false, error: 'No se pudo conectar con GitHub' };
  }
  if (!r.ok) return { ...base, ok: false, error: r.status === 401 ? 'Token inválido o vencido' : `GitHub respondió HTTP ${r.status}` };
  const repo = await r.json();
  const canWrite = Boolean(repo.permissions?.push);
  return { ...base, ok: canWrite, canWrite, error: canWrite ? undefined : 'El token no tiene permiso de escritura (Contents: Read and write)' };
}

// `fresh`: evita respuestas guardadas (justo después de un commit GitHub puede
// devolver por unos segundos la versión anterior).
async function readMeta(cfg, path, fresh = false) {
  const r = await gh(`/repos/${cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}${fresh ? `&_=${Date.now()}` : ''}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondió HTTP ${r.status} al leer ${path}`);
  return r.json();
}

// Devuelve { text, sha } o null si el archivo no existe.
export async function getFile({ path }) {
  const cfg = getConfig();
  const meta = await readMeta(cfg, path);
  if (!meta) return null;
  if (meta.content && meta.encoding === 'base64') return { text: fromBase64(meta.content), sha: meta.sha };
  // Archivos de más de 1 MB: la API no incluye el contenido; se lee el "blob"
  // (hasta 100 MB). Nunca se devuelve un archivo vacío por error.
  const blob = await gh(`/repos/${cfg.repo}/git/blobs/${meta.sha}`);
  if (!blob.ok) throw new Error(`GitHub respondió HTTP ${blob.status} al leer ${path}`);
  const data = await blob.json();
  if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error(`No se pudo leer el contenido de ${path}`);
  return { text: fromBase64(data.content), sha: meta.sha };
}

// Crea o reemplaza un archivo con un commit.
export async function putFile({ path, text, message }) {
  if (!WRITABLE.test(path)) throw new Error(`Ruta no permitida: ${path}`);
  const cfg = getConfig();
  if (!cfg.token) throw new Error('Falta el token de GitHub (⚙ Ajustes)');
  const content = toBase64(text);
  let last = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    // Entre intentos se espera (1, 2, 4, 8 s) para que GitHub refleje el último commit.
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    const meta = await readMeta(cfg, path, attempt > 0);
    const r = await gh(`/repos/${cfg.repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: { message: message || `Actualizar ${path}`, content, branch: cfg.branch, ...(meta ? { sha: meta.sha } : {}) },
    });
    if (r.ok) return { ok: true };
    let detail = '';
    try {
      detail = (await r.json())?.message || '';
    } catch {
      // sin detalle
    }
    last = `HTTP ${r.status}${detail ? `: ${detail}` : ''}`;
    // 409/422: el archivo cambió entre la lectura y la escritura (o GitHub aún no lo refleja); se reintenta.
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub respondió ${last} al guardar ${path}`);
  }
  throw new Error(`No se pudo guardar ${path} tras varios intentos (${last})`);
}
