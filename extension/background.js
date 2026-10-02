// Service worker de la extensión: recibe pedidos de la página web (vía
// bridge.js) o de la página de diagnóstico y los resuelve con cada fuente.
import sofascore, * as sofascoreApi from './sources/sofascore.js';
import flashscore, * as flashscoreApi from './sources/flashscore.js';
import fotmob, * as fotmobApi from './sources/fotmob.js';
import espn, * as espnApi from './sources/espn.js';
import understat, * as understatApi from './sources/understat.js';
import betano, * as betanoApi from './sources/betano.js';
import apuestatotal, * as apuestatotalApi from './sources/apuestatotal.js';

export const SOURCES = [sofascore, flashscore, fotmob, espn, understat, betano, apuestatotal];

const API = {
  sofascore: sofascoreApi,
  flashscore: flashscoreApi,
  fotmob: fotmobApi,
  espn: espnApi,
  understat: understatApi,
  betano: betanoApi,
  apuestatotal: apuestatotalApi,
};

// Funciones que la página puede pedir: { action: 'call', params: { source, fn, args } }.
const ALLOWED = new Set(['getMatches', 'getMatchDetails', 'getNews', 'getOdds', 'getEvents', 'getTeamStrength']);

async function diagnose(id) {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`Fuente desconocida: ${id}`);
  const started = Date.now();
  try {
    const result = await source.diagnose();
    return { id, name: source.name, ok: true, ms: Date.now() - started, ...result };
  } catch (e) {
    return {
      id,
      name: source.name,
      ok: false,
      ms: Date.now() - started,
      error: e.message,
      status: e.status,
      mode: e.mode,
      url: e.url,
      snippet: e.snippet,
      attempts: e.attempts,
    };
  }
}

async function handle({ action, params = {} }) {
  switch (action) {
    case 'sources':
      return SOURCES.map(({ id, name, role }) => ({ id, name, role }));
    case 'diagnose':
      return diagnose(params.source);
    case 'call': {
      const { source, fn, args = {} } = params;
      if (!ALLOWED.has(fn) || typeof API[source]?.[fn] !== 'function') throw new Error(`Función no disponible: ${source}.${fn}`);
      return API[source][fn](args);
    }
    default:
      throw new Error(`Acción desconocida: ${action}`);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg).then(
    (data) => reply({ ok: true, data }),
    (e) => reply({ ok: false, error: e.message }),
  );
  return true; // respuesta asíncrona
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('diagnostico.html') }));
