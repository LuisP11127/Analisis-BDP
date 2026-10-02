// Service worker de la extensión: recibe pedidos de la página web (vía
// bridge.js) o de la página de diagnóstico y los resuelve con cada fuente.
import sofascore, * as sofascoreApi from './sources/sofascore.js';
import flashscore, * as flashscoreApi from './sources/flashscore.js';
import fotmob, * as fotmobApi from './sources/fotmob.js';
import espn, * as espnApi from './sources/espn.js';
import understat, * as understatApi from './sources/understat.js';
import betano, * as betanoApi from './sources/betano.js';
import apuestatotal, * as apuestatotalApi from './sources/apuestatotal.js';
import * as githubApi from './sources/github.js';
import { closeIdleTabs, CLOSE_TABS_ALARM } from './lib/net.js';

export const SOURCES = [sofascore, flashscore, fotmob, espn, understat, betano, apuestatotal];

const API = {
  sofascore: sofascoreApi,
  flashscore: flashscoreApi,
  fotmob: fotmobApi,
  espn: espnApi,
  understat: understatApi,
  betano: betanoApi,
  apuestatotal: apuestatotalApi,
  github: githubApi,
};

// Funciones que puede pedir la página web: { action: 'call', params: { source, fn, args } }.
const PAGE_ALLOWED = {
  sofascore: ['getSportEvents', 'getEventDetails', 'getEventResults', 'getMatches'],
  flashscore: ['getMatches', 'getNews', 'getSportDay', 'getTeamFeeds', 'getMatchFeeds'],
  fotmob: ['getMatches', 'getNews'],
  espn: ['getMatches', 'getNews'],
  understat: ['getTeamStrength'],
  betano: ['getOdds', 'getEventMarkets'],
  apuestatotal: ['getEventList', 'getMarkets', 'getOdds'],
  github: ['status', 'getFile', 'putFile', 'getPublicConfig'],
};
// Solo desde las páginas de la propia extensión (configurar el token).
const EXTENSION_ONLY = { github: ['setConfig'] };

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

async function handle({ action, params = {} }, fromExtension) {
  switch (action) {
    case 'sources':
      return SOURCES.map(({ id, name, role }) => ({ id, name, role }));
    case 'diagnose':
      return diagnose(params.source);
    case 'call': {
      const { source, fn, args = {} } = params;
      const allowed = PAGE_ALLOWED[source]?.includes(fn) || (fromExtension && EXTENSION_ONLY[source]?.includes(fn));
      if (!allowed || typeof API[source]?.[fn] !== 'function') throw new Error(`Función no disponible: ${source}.${fn}`);
      return API[source][fn](args);
    }
    default:
      throw new Error(`Acción desconocida: ${action}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const fromExtension = Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
  handle(msg, fromExtension).then(
    (data) => reply({ ok: true, data }),
    (e) => reply({ ok: false, error: e.message }),
  );
  return true; // respuesta asíncrona
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLOSE_TABS_ALARM) closeIdleTabs();
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('diagnostico.html') }));
