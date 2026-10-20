// Pestaña "Apuestas" (demo): casa de apuestas con dinero ficticio, ordenada
// como Betano: deportes y ligas a la izquierda, partidos con sus cuotas 1-X-2 al
// centro (cada partido abre todos sus mercados por pestañas) y el boleto a la
// derecha (abajo en el celular). Las apuestas se liquidan con "Actualizar
// resultados", igual que los picks.
import * as bets from '../bets.js';
import * as book from '../sportsbook.js';
import * as store from '../storage.js';
import { sportOf } from '../sports.js';
import { addDays, flag, fmtDateTime, groupBy, h, limaDateOf, limaToday } from '../util.js';

const QUICK = [10, 50, 100, 500];
const STATUS = { pending: 'Abierta', won: 'Ganada', lost: 'Perdida', void: 'Anulada', half_won: 'Medio ganada', half_lost: 'Medio perdida' };
const LEG_STATUS = { ...STATUS, pending: 'Pendiente', void: 'Nula' };
const LS_SPORT = 'bdp:apuestas-deporte';

const soles = (x) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(x || 0);
const odds = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(2));
const amount = (v) => Math.round(Number(String(v).replace(',', '.')) * 100) / 100;

function readLS(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento local: solo se pierde la preferencia
  }
}

// "Hoy 15:30", "Mañana 20:00" o "23/10, 18:00".
function when(ms) {
  const d = limaDateOf(ms);
  const time = fmtDateTime(ms).split(/,\s*|\s+/).pop();
  if (d === limaToday()) return `Hoy ${time}`;
  if (d === addDays(limaToday(), 1)) return `Mañana ${time}`;
  return fmtDateTime(ms);
}

export class ApuestasView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.s = {
      sport: readLS(LS_SPORT, 'football'),
      sports: null,
      rows: null,
      status: 'idle',
      error: null,
      betano: null, // { matched, error, loading }
      league: null,
      open: null, // id del partido abierto
      tab: 'todos',
      collapsed: new Set(),
      slip: [], // selecciones
      kind: 'simple',
      stakes: {}, // clave de selección -> monto (simples)
      stake: 10, // combinada
      errors: [],
      wallet: null,
      walletLoaded: false,
      view: 'deportes', // o 'mis'
      mine: 'abiertas',
      slipOpen: false, // celular
      placing: false,
    };
  }

  // ---- Datos ----

  async load({ force = false } = {}) {
    const { s } = this;
    s.status = 'loading';
    this.render();
    try {
      s.sports = await book.sportsWithOdds({ force: true }); // el índice es chico: siempre al día
      if (s.sports.length && !s.sports.some((x) => x.slug === s.sport)) s.sport = s.sports[0].slug;
      await this.loadSport({ force, silent: true });
      if (!s.walletLoaded || force) await this.loadWallet();
    } catch (e) {
      s.status = 'error';
      s.error = e.message;
    }
    this.render();
  }

  async loadSport({ force = false, silent = false } = {}) {
    const { s } = this;
    const sport = s.sport;
    s.status = 'loading';
    s.rows = null;
    s.betano = null;
    if (!silent) this.render();
    try {
      const rows = await book.loadEvents(sport, { force });
      if (s.sport !== sport) return;
      s.rows = rows;
      s.status = 'ready';
      if (this.app.extOk && rows.length) {
        s.betano = { loading: true };
        this.render();
        const r = await book.addBetano(sport, rows);
        if (s.sport !== sport) return;
        s.betano = r;
      }
    } catch (e) {
      s.status = 'error';
      s.error = e.message;
    }
    this.render();
  }

  async loadWallet() {
    const { s } = this;
    try {
      s.wallet = await bets.loadWallet();
    } catch (e) {
      this.app.toast(`No se pudo leer tus apuestas: ${e.message}`, 6000);
    }
    s.walletLoaded = true;
  }

  get summary() {
    return bets.walletSummary(this.s.wallet);
  }

  // ---- Acciones ----

  setSport(slug) {
    const { s } = this;
    if (s.sport === slug && s.view === 'deportes' && !s.open) return;
    s.sport = slug;
    s.league = null;
    s.open = null;
    s.view = 'deportes';
    writeLS(LS_SPORT, slug);
    this.loadSport();
  }

  setLeague(key) {
    this.s.league = this.s.league === key ? null : key;
    this.s.open = null;
    this.s.view = 'deportes';
    this.render();
  }

  async openEvent(id) {
    const { s } = this;
    s.open = id;
    s.tab = 'todos';
    s.collapsed.clear();
    s.view = 'deportes';
    this.render();
    this.root.scrollIntoView?.({ block: 'start' });
    const row = s.rows?.find((r) => r.ev.id === id);
    if (row?.betano?.url && !row.full && this.app.extOk) {
      row.loadingAll = true;
      this.render();
      try {
        await book.betanoAllMarkets(row);
      } catch (e) {
        row.allError = e.message;
      }
      row.loadingAll = false;
      if (s.open === id) this.render();
    }
  }

  toggle(row, o, marketName) {
    const { s } = this;
    const sel = book.selectionOf(row, o, marketName);
    const key = bets.legKey(sel);
    const i = s.slip.findIndex((x) => bets.legKey(x) === key);
    if (i >= 0) s.slip.splice(i, 1);
    else {
      s.slip.push(sel);
      s.stakes[key] ??= 10;
    }
    s.errors = [];
    // Como en la casa: con la segunda selección pasa a combinada; con dos del mismo partido, a simples.
    if (s.slip.length < 2 || this.sameMatch()) s.kind = 'simple';
    else if (s.slip.length === 2 && i < 0) s.kind = 'combinada';
    this.render();
  }

  remove(key) {
    const { s } = this;
    s.slip = s.slip.filter((x) => bets.legKey(x) !== key);
    if (s.slip.length < 2) s.kind = 'simple';
    s.errors = [];
    this.render();
  }

  clear() {
    this.s.slip = [];
    this.s.kind = 'simple';
    this.s.errors = [];
    this.render();
  }

  sameMatch() {
    return new Set(this.s.slip.map((x) => x.eventId)).size < this.s.slip.length;
  }

  ticket() {
    const { s } = this;
    return bets.buildBets(s.slip, { kind: s.kind, stake: amount(s.stake), stakes: s.slip.map((x) => amount(s.stakes[bets.legKey(x)])) }, this.summary.balance);
  }

  async place() {
    const { s, app } = this;
    if (s.placing) return;
    const t = this.ticket();
    if (t.errors.length) {
      s.errors = t.errors;
      return this.render();
    }
    s.placing = true;
    this.render();
    try {
      s.wallet = await bets.placeBets(t.bets, s.wallet);
      s.slip = [];
      s.kind = 'simple';
      s.errors = [];
      s.slipOpen = false;
      app.toast(`${t.bets.length === 1 ? 'Apuesta realizada' : `${t.bets.length} apuestas realizadas`} por ${soles(t.total)} · saldo ${soles(this.summary.balance)}`, 6000);
    } catch (e) {
      s.errors = [e.message];
    } finally {
      s.placing = false;
    }
    this.render();
  }

  async reset() {
    if (!confirm(`¿Reiniciar el saldo a ${soles(bets.INITIAL)}? Tus apuestas actuales se guardan en el archivo y dejan de contar.`)) return;
    try {
      this.s.wallet = await bets.resetWallet();
      this.app.toast(`Saldo reiniciado: ${soles(bets.INITIAL)}`);
    } catch (e) {
      this.app.toast(`No se pudo reiniciar: ${e.message}`, 6000);
    }
    this.render();
  }

  // Después de "Actualizar resultados".
  async refreshWallet() {
    await this.loadWallet();
    this.render();
  }

  // ---- Vista ----

  render() {
    const { s } = this;
    document.body.classList.toggle('slip-open', s.slipOpen);
    this.root.replaceChildren(
      h(
        'div',
        { class: 'sb' },
        this.topBar(),
        h('div', { class: 'sb-grid' }, this.sidebar(), h('div', { class: 'sb-main' }, this.main()), this.slipPanel()),
        this.slipBar(),
      ),
    );
  }

  topBar() {
    const { s, app } = this;
    const sum = this.summary;
    return h(
      'div',
      { class: 'sb-top' },
      h('span', { class: 'sb-demo', title: 'Dinero ficticio: no es una casa de apuestas real' }, 'DEMO'),
      h('span', { class: 'sb-balance' }, h('span', { class: 'note' }, 'Saldo '), h('b', {}, soles(sum.balance))),
      sum.openCount ? h('span', { class: 'note' }, `${sum.openCount} ${sum.openCount === 1 ? 'abierta' : 'abiertas'} · ${soles(sum.open)} en juego`) : null,
      h(
        'div',
        { class: 'segmented sb-views' },
        h('button', { class: s.view === 'deportes' ? 'active' : '', onclick: () => ((s.view = 'deportes'), this.render()) }, 'Deportes'),
        h('button', { class: s.view === 'mis' ? 'active' : '', onclick: () => ((s.view = 'mis'), (s.open = null), this.render()) }, `Mis apuestas${sum.openCount ? ` (${sum.openCount})` : ''}`),
      ),
      h('button', { class: 'btn small', disabled: app.storage.mode === 'lectura', onclick: () => app.updateResults(), title: 'Liquida las apuestas de los partidos que ya terminaron' }, 'Actualizar resultados'),
      h('button', { class: 'btn small ghost', onclick: () => this.load({ force: true }), title: 'Volver a leer partidos y cuotas' }, '↻'),
    );
  }

  sidebar() {
    const { s } = this;
    const sports = s.sports || [];
    const leagues = this.leagues();
    return h(
      'aside',
      { class: 'sb-side' },
      h('h4', {}, 'Deportes'),
      h(
        'div',
        { class: 'sb-sports' },
        sports.map((x) =>
          h(
            'button',
            { class: `sb-sport${x.slug === s.sport ? ' on' : ''}`, onclick: () => this.setSport(x.slug) },
            h('span', { class: 'ico' }, x.icon),
            h('span', { class: 'name' }, x.name),
            h('span', { class: 'n' }, x.count),
          ),
        ),
      ),
      leagues.length ? h('h4', { class: 'sb-d' }, 'Ligas') : null,
      leagues.length
        ? h(
            'div',
            { class: 'sb-leagues sb-d' },
            leagues.map((l) =>
              h('button', { class: `sb-league${l.key === s.league ? ' on' : ''}`, onclick: () => this.setLeague(l.key) }, h('span', {}, `${flag(l.alpha2)} ${l.name}`), h('span', { class: 'n' }, l.rows.length)),
            ),
          )
        : null,
    );
  }

  leagues() {
    const rows = (this.s.rows || []).filter((r) => r.ev.start > Date.now());
    return [...groupBy(rows, (r) => `${r.ev.category.name}|${r.ev.tournament.id}`).entries()]
      .map(([key, list]) => ({ key, rows: list, name: list[0].ev.tournament.name, country: list[0].ev.category.name, alpha2: list[0].ev.category.alpha2, priority: list[0].ev.tournament.priority || 0 }))
      .sort((a, b) => b.priority - a.priority || a.rows[0].ev.start - b.rows[0].ev.start);
  }

  main() {
    const { s } = this;
    if (s.view === 'mis') return this.myBets();
    if (s.status === 'loading' && !s.rows) return h('div', { class: 'empty' }, 'Cargando partidos y cuotas…');
    if (s.status === 'error') return h('div', { class: 'banner warn' }, `No se pudieron leer los partidos: ${s.error}`);
    if (s.sports && !s.sports.length) return h('div', { class: 'empty' }, 'Todavía no hay cuotas publicadas para hoy ni mañana. GitHub Actions las publica cada 2 horas.');
    if (s.open) {
      const row = s.rows?.find((r) => r.ev.id === s.open);
      if (row) return this.eventPage(row);
      s.open = null;
    }
    return this.eventList();
  }

  sourceNote() {
    const { s, app } = this;
    const b = s.betano;
    if (b?.loading) return h('div', { class: 'note sb-src' }, 'Buscando las cuotas de Betano…');
    if (b?.matched) return h('div', { class: 'note sb-src' }, `Cuotas de Betano en ${b.matched} partidos; el resto, de Apuesta Total.`);
    const at = s.rows?.[0]?.generated ? ` (publicadas ${app.ago(s.rows[0].generated)})` : '';
    return h('div', { class: 'note sb-src' }, `Cuotas de Apuesta Total${at}.${app.extOk ? (b?.error ? ` Betano no respondió: ${b.error}` : '') : ' Con la extensión en la PC se usan las de Betano.'}`);
  }

  eventList() {
    const { s } = this;
    const sport = sportOf(s.sport);
    let leagues = this.leagues();
    if (s.league) leagues = leagues.filter((l) => l.key === s.league);
    const chips = h(
      'div',
      { class: 'sports sb-chips sb-m' },
      (s.sports || []).map((x) => h('button', { class: `sport${x.slug === s.sport ? ' active' : ''}`, onclick: () => this.setSport(x.slug) }, `${x.icon} ${x.name}`)),
    );
    if (!leagues.length) return [chips, h('div', { class: 'empty' }, s.status === 'loading' ? 'Cargando…' : `No hay partidos de ${sport.name.toLowerCase()} por empezar con cuotas.`)];
    const head = (list) => (list[0] && book.mainOdds(list[0].offers)?.length === 2 ? ['1', '2'] : ['1', 'X', '2']);
    return [
      chips,
      h('h2', { class: 'sb-title' }, `${sport.icon} ${sport.name}`),
      this.sourceNote(),
      leagues.map((l) =>
        h(
          'section',
          { class: 'sb-group' },
          h('div', { class: 'sb-group-h' }, h('span', {}, `${flag(l.alpha2)} ${l.country} · `, h('b', {}, l.name)), h('span', { class: 'sb-cols' }, head(l.rows).map((c) => h('span', {}, c)))),
          l.rows.map((row) => this.eventRow(row)),
        ),
      ),
    ];
  }

  eventRow(row) {
    const { ev } = row;
    const main = book.mainOdds(row.offers);
    const panels = book.marketPanels(row.offers, ev);
    return h(
      'div',
      { class: 'sb-ev' },
      h(
        'button',
        { class: 'sb-ev-info', onclick: () => this.openEvent(ev.id) },
        h('span', { class: 'sb-time' }, when(ev.start)),
        h('span', { class: 'sb-teams' }, h('span', {}, ev.home.name), h('span', {}, ev.away.name)),
      ),
      h('div', { class: `sb-odds n${main?.length || 3}` }, main ? main.map((o, i) => this.oddButton(row, o, panels.find((p) => p.market === o.market)?.title || 'Resultado final', main.length === 2 ? ['1', '2'][i] : ['1', 'X', '2'][i])) : h('span', { class: 'note' }, 'Ver mercados')),
      h('button', { class: 'sb-more', onclick: () => this.openEvent(ev.id), title: 'Todos los mercados' }, `+${panels.length}`),
    );
  }

  oddButton(row, o, marketName, label) {
    const key = bets.legKey({ eventId: row.ev.id, market: o.market, sel: o.sel, line: o.line });
    const on = this.s.slip.some((x) => bets.legKey(x) === key);
    return h(
      'button',
      { class: `odd${on ? ' on' : ''}`, onclick: () => this.toggle(row, o, marketName), title: `${book.fullLabel(o, row.ev)} @ ${odds(o.price)}` },
      h('span', { class: 'o-l' }, label),
      h('span', { class: 'o-p' }, odds(o.price)),
    );
  }

  eventPage(row) {
    const { s } = this;
    const { ev } = row;
    const panels = book.marketPanels(row.offers, ev);
    const tabs = ['todos', ...book.TAB_ORDER.filter((t) => panels.some((p) => p.tab === t))];
    if (!tabs.includes(s.tab)) s.tab = 'todos';
    const shown = s.tab === 'todos' ? panels : panels.filter((p) => p.tab === s.tab);
    const src =
      row.book === 'betano'
        ? row.loadingAll
          ? 'Betano: cargando todos los mercados del partido…'
          : `Cuotas de Betano${row.full ? ' (todos los mercados)' : ''}${row.allError ? ` · no se pudieron leer todos: ${row.allError}` : ''}`
        : `Cuotas de Apuesta Total (publicadas ${this.app.ago(row.generated)})`;
    return [
      h('button', { class: 'btn small ghost sb-back', onclick: () => ((s.open = null), this.render()) }, '‹ Volver'),
      h(
        'div',
        { class: 'sb-evhead' },
        h('div', { class: 'note' }, `${flag(ev.category.alpha2)} ${ev.category.name} · ${ev.tournament.name}`),
        h('h2', {}, `${ev.home.name} vs ${ev.away.name}`),
        h('div', { class: 'note' }, `${sportOf(ev.sport).icon} ${when(ev.start)} · ${panels.length} mercados · ${src}`),
      ),
      h(
        'div',
        { class: 'sb-tabs', role: 'tablist' },
        tabs.map((t) => h('button', { class: t === s.tab ? 'on' : '', onclick: () => ((s.tab = t), this.render()) }, t === 'todos' ? 'Todos' : book.tabName(t, ev.sport))),
      ),
      shown.map((p) => this.marketPanel(row, p)),
    ];
  }

  marketPanel(row, p) {
    const { s } = this;
    const closed = s.collapsed.has(p.key);
    return h(
      'div',
      { class: `sb-mkt${closed ? ' closed' : ''}` },
      h('button', { class: 'sb-mkt-h', onclick: () => (closed ? s.collapsed.delete(p.key) : s.collapsed.add(p.key), this.render()) }, h('span', {}, p.title), h('span', { class: 'chev' }, closed ? '▸' : '▾')),
      closed
        ? null
        : h(
            'div',
            { class: 'sb-mkt-b' },
            p.rows.map((r) => h('div', { class: `sb-row c${Math.min(r.length, 3)}` }, r.map((o) => this.oddButton(row, o, p.title, book.shortLabel(o, row.ev))))),
          ),
    );
  }

  // ---- Boleto ----

  slipPanel() {
    const { s, app } = this;
    const n = s.slip.length;
    const canBet = store.canWrite();
    const body = [];
    if (!n) body.push(h('p', { class: 'note' }, 'Toca una cuota para agregarla al boleto.'));
    else {
      const same = this.sameMatch();
      body.push(
        h(
          'div',
          { class: 'segmented wide sb-kind' },
          h('button', { class: s.kind === 'simple' ? 'active' : '', onclick: () => ((s.kind = 'simple'), (s.errors = []), this.render()) }, n > 1 ? `Simples (${n})` : 'Simple'),
          h(
            'button',
            { class: s.kind === 'combinada' ? 'active' : '', disabled: n < 2 || same, title: same ? 'Hay selecciones del mismo partido: no se pueden combinar' : '', onclick: () => ((s.kind = 'combinada'), (s.errors = []), this.render()) },
            'Combinada',
          ),
        ),
      );
      if (same && n > 1) body.push(h('p', { class: 'note warn-text' }, 'Hay selecciones del mismo partido: solo se pueden apostar como simples.'));
      body.push(h('div', { class: 'sb-sels' }, s.slip.map((x) => this.slipItem(x))));
      if (s.kind === 'combinada') {
        body.push(
          h('div', { class: 'sb-line' }, h('span', {}, 'Cuota total'), h('b', {}, odds(bets.totalOdds(s.slip)))),
          this.stakeInput(s.stake, (v) => (s.stake = v)),
        );
      }
      const t = this.ticket();
      const win = s.kind === 'combinada' ? amount(s.stake) * bets.totalOdds(s.slip) : s.slip.reduce((x, sel) => x + amount(s.stakes[bets.legKey(sel)]) * sel.price, 0);
      body.push(
        h('div', { class: 'sb-line' }, h('span', {}, 'Total apostado'), h('b', { 'data-total': '' }, soles(t.total))),
        h('div', { class: 'sb-line big' }, h('span', {}, 'Ganancia potencial'), h('b', { 'data-win': '' }, soles(win))),
        s.errors.length ? h('ul', { class: 'sb-errors' }, s.errors.map((e) => h('li', {}, e))) : null,
        h(
          'button',
          { class: 'btn primary sb-place', disabled: s.placing || !canBet, title: canBet ? '' : 'Este navegador no permite guardar: pega tu token de GitHub en Ajustes', onclick: () => this.place() },
          s.placing ? 'Guardando…' : `Apostar ${soles(t.total)}`,
        ),
        canBet ? null : h('p', { class: 'note' }, 'Para apostar, pega tu token de GitHub en ⚙ Ajustes.'),
      );
    }
    return h(
      'aside',
      { class: 'sb-slip' },
      h(
        'div',
        { class: 'sb-slip-h' },
        h('b', {}, 'Boleto'),
        n ? h('span', { class: 'sb-count' }, n) : null,
        h('span', { class: 'sb-spacer' }),
        n ? h('button', { class: 'btn small ghost', onclick: () => this.clear() }, 'Limpiar') : null,
        h('button', { class: 'btn small ghost sb-m', onclick: () => ((s.slipOpen = false), this.render()) }, 'Cerrar'),
      ),
      body,
      h('p', { class: 'note sb-legal' }, `Dinero demo (empiezas con ${soles(bets.INITIAL)}). ${app.storage.mode === 'github-web' || app.storage.mode === 'github' ? 'Tus apuestas se guardan en GitHub.' : ''}`),
    );
  }

  slipItem(x) {
    const { s } = this;
    const key = bets.legKey(x);
    const started = !(x.start > Date.now());
    return h(
      'div',
      { class: `sb-sel${started ? ' started' : ''}` },
      h('div', { class: 'sb-sel-top' }, h('b', {}, x.label), h('span', { class: 'o-p' }, odds(x.price)), h('button', { class: 'sb-x', title: 'Quitar', onclick: () => this.remove(key) }, '×')),
      h('div', { class: 'note' }, `${x.marketName} · ${x.match} · ${started ? 'ya empezó' : when(x.start)}`),
      s.kind === 'simple' ? this.stakeInput(s.stakes[key], (v) => (s.stakes[key] = v), x.price) : null,
    );
  }

  // Monto con botones rápidos; al escribir solo se actualizan los totales.
  stakeInput(value, set, price) {
    const input = h('input', {
      type: 'number',
      min: bets.MIN_STAKE,
      step: '0.01',
      inputmode: 'decimal',
      value: value ?? '',
      'aria-label': 'Monto en soles',
      oninput: (e) => {
        set(e.target.value);
        this.updateTotals();
      },
    });
    return h(
      'div',
      { class: 'sb-stake' },
      h('label', {}, h('span', { class: 'cur' }, 'S/'), input),
      h(
        'div',
        { class: 'sb-quick' },
        QUICK.map((q) =>
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                set(q);
                input.value = q;
                this.updateTotals();
              },
            },
            `${q}`,
          ),
        ),
      ),
      price ? h('span', { class: 'note', 'data-ret': '' }, `Gana ${soles(amount(value) * price)}`) : null,
    );
  }

  updateTotals() {
    const { s } = this;
    const t = this.ticket();
    const win = s.kind === 'combinada' ? amount(s.stake) * bets.totalOdds(s.slip) : s.slip.reduce((x, sel) => x + amount(s.stakes[bets.legKey(sel)]) * sel.price, 0);
    const box = this.root.querySelector('.sb-slip');
    if (!box) return;
    box.querySelector('[data-total]').textContent = soles(t.total);
    box.querySelector('[data-win]').textContent = soles(win);
    const place = box.querySelector('.sb-place');
    if (place && !s.placing) place.textContent = `Apostar ${soles(t.total)}`;
    if (s.kind === 'simple') box.querySelectorAll('.sb-sel').forEach((el, i) => {
      const sel = s.slip[i];
      const ret = el.querySelector('[data-ret]');
      if (sel && ret) ret.textContent = `Gana ${soles(amount(s.stakes[bets.legKey(sel)]) * sel.price)}`;
    });
    const bar = this.root.querySelector('.sb-slipbar [data-win]');
    if (bar) bar.textContent = soles(win);
  }

  // Celular: barra fija con el boleto.
  slipBar() {
    const { s } = this;
    const n = s.slip.length;
    if (!n) return null;
    const total = s.kind === 'combinada' ? bets.totalOdds(s.slip) : null;
    return h(
      'button',
      { class: 'sb-slipbar sb-m', onclick: () => ((s.slipOpen = true), this.render()) },
      h('span', { class: 'sb-count' }, n),
      h('span', {}, s.kind === 'combinada' ? `Combinada · cuota ${odds(total)}` : n === 1 ? '1 selección' : `${n} simples`),
      h('b', {}, 'Ver boleto'),
    );
  }

  // ---- Mis apuestas ----

  myBets() {
    const { s } = this;
    const all = (s.wallet?.bets || []).slice().reverse();
    const open = all.filter((b) => b.status === 'pending');
    const done = all.filter((b) => b.status !== 'pending');
    const sum = this.summary;
    const list = s.mine === 'abiertas' ? open : done;
    return [
      h('h2', { class: 'sb-title' }, 'Mis apuestas'),
      h(
        'div',
        { class: 'sb-stats' },
        this.stat('Saldo', soles(sum.balance)),
        this.stat('En juego', soles(sum.open)),
        this.stat('Ganancia neta', soles(sum.profit), sum.profit > 0 ? 'pos' : sum.profit < 0 ? 'neg' : ''),
        this.stat('Ganadas / perdidas', `${sum.won} / ${sum.lost}`),
      ),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'div',
          { class: 'segmented' },
          h('button', { class: s.mine === 'abiertas' ? 'active' : '', onclick: () => ((s.mine = 'abiertas'), this.render()) }, `Abiertas (${open.length})`),
          h('button', { class: s.mine === 'liquidadas' ? 'active' : '', onclick: () => ((s.mine = 'liquidadas'), this.render()) }, `Liquidadas (${done.length})`),
        ),
        h('span', { class: 'sb-spacer' }),
        h('button', { class: 'btn small ghost', disabled: !store.canWrite(), onclick: () => this.reset() }, `Reiniciar saldo (${soles(bets.INITIAL)})`),
      ),
      list.length
        ? list.map((b) => this.betCard(b))
        : h('div', { class: 'empty' }, s.mine === 'abiertas' ? 'No tienes apuestas abiertas. Ve a Deportes y toca una cuota.' : 'Todavía no hay apuestas liquidadas. Se liquidan con "Actualizar resultados" cuando terminan los partidos.'),
    ];
  }

  stat(label, value, cls = '') {
    return h('div', { class: 'sb-stat' }, h('span', { class: 'note' }, label), h('b', { class: cls }, value));
  }

  betCard(b) {
    const ret = b.status === 'pending' ? b.stake * (b.kind === 'combinada' ? b.odds : b.legs[0].price) : b.payout;
    return h(
      'div',
      { class: `sb-bet ${b.status}` },
      h(
        'div',
        { class: 'sb-bet-h' },
        h('b', {}, b.kind === 'combinada' ? `Combinada (${b.legs.length})` : 'Simple'),
        h('span', { class: `status-pill ${b.status === 'pending' ? 'pending' : b.status}` }, STATUS[b.status] || b.status),
        h('span', { class: 'note' }, fmtDateTime(Date.parse(b.created))),
      ),
      h(
        'ul',
        { class: 'leg-list' },
        b.legs.map((l) =>
          h(
            'li',
            {},
            b.kind === 'combinada' ? h('span', { class: `status-pill ${l.status}` }, LEG_STATUS[l.status] || l.status) : null,
            h('span', {}, `${sportOf(l.sport).icon} ${l.match} (${when(l.start)}): `),
            h('b', {}, l.label),
            h('span', { class: 'note' }, `@ ${odds(l.price)}${l.score ? ` · ${l.score.home}-${l.score.away}` : ''}${l.noData ? ' · sin datos para liquidarla' : ''}`),
          ),
        ),
      ),
      h(
        'div',
        { class: 'sb-bet-f' },
        h('span', {}, 'Monto ', h('b', {}, soles(b.stake))),
        h('span', {}, 'Cuota ', h('b', {}, odds(b.odds))),
        h('span', {}, b.status === 'pending' ? 'Ganancia potencial ' : 'Pagó ', h('b', { class: b.status === 'pending' ? '' : ret > b.stake ? 'pos' : ret < b.stake ? 'neg' : '' }, soles(ret))),
      ),
    );
  }
}
