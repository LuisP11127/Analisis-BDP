// Guarda y lee archivos del repositorio en GitHub (historial de apuestas y
// red neuronal). El token se guarda solo en la extensión: la página web nunca
// lo ve y solo puede escribir archivos JSON dentro de docs/data/.
const API = 'https://api.github.com';
const DEFAULTS = { repo: 'LuisP11127/Analisis-BDP', branch: 'main', token: '' };
const WRITABLE = /^docs\/data\/[\w\-./]+\.json$/;

export async function getConfig() {
  const { github = {} } = await chrome.storage.local.get('github');
  return { ...DEFAULTS, ...github };
}

// Configuración sin el token (para mostrarla).
export async function getPublicConfig() {
  const { token, ...rest } = await getConfig();
  return { ...rest, hasToken: Boolean(token) };
}

export async function setConfig({ token, repo, branch } = {}) {
  const current = await getConfig();
  const next = {
    token: token === undefined ? current.token : String(token).trim(),
    repo: (repo || current.repo).trim(),
    branch: (branch || current.branch).trim(),
  };
  await chrome.storage.local.set({ github: next });
  return status();
}

async function gh(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const { token } = await getConfig();
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

export async function status() {
  const cfg = await getConfig();
  const base = { repo: cfg.repo, branch: cfg.branch, configured: Boolean(cfg.token) };
  if (!cfg.token) return base;
  const r = await gh(`/repos/${cfg.repo}`);
  if (!r.ok) return { ...base, ok: false, error: r.status === 401 ? 'Token inválido o vencido' : `GitHub respondió HTTP ${r.status}` };
  const repo = await r.json();
  const canWrite = Boolean(repo.permissions?.push);
  return { ...base, ok: canWrite, canWrite, error: canWrite ? undefined : 'El token no tiene permiso de escritura (Contents: Read and write)' };
}

async function readMeta(cfg, path) {
  const r = await gh(`/repos/${cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondió HTTP ${r.status} al leer ${path}`);
  return r.json();
}

// Devuelve { text, sha } o null si el archivo no existe.
export async function getFile({ path }) {
  const cfg = await getConfig();
  const meta = await readMeta(cfg, path);
  if (!meta) return null;
  if (meta.content && meta.encoding === 'base64') return { text: fromBase64(meta.content), sha: meta.sha };
  // Archivos de más de 1 MB: la API no incluye el contenido, se pide en crudo.
  const raw = await gh(`/repos/${cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}`, { accept: 'application/vnd.github.raw' });
  if (!raw.ok) throw new Error(`GitHub respondió HTTP ${raw.status} al leer ${path}`);
  return { text: await raw.text(), sha: meta.sha };
}

// Crea o reemplaza un archivo con un commit.
export async function putFile({ path, text, message }) {
  if (!WRITABLE.test(path)) throw new Error(`Ruta no permitida: ${path}`);
  const cfg = await getConfig();
  if (!cfg.token) throw new Error('Falta configurar el token de GitHub en la extensión');
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await readMeta(cfg, path);
    const r = await gh(`/repos/${cfg.repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: { message: message || `Actualizar ${path}`, content: toBase64(text), branch: cfg.branch, ...(meta ? { sha: meta.sha } : {}) },
    });
    if (r.ok) return { ok: true };
    // 409/422: alguien cambió el archivo entre la lectura y la escritura; se reintenta.
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub respondió HTTP ${r.status} al guardar ${path}`);
  }
  throw new Error(`No se pudo guardar ${path} tras varios intentos`);
}
