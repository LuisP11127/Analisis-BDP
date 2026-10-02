// Pestaña "Partidos": deportes, ligas y partidos del día con casillas para
// marcar ligas completas o partidos sueltos. Dos fuentes:
//  - Automático: partidos de Flashscore y cuotas de Apuesta Total publicados
//    cada 2 horas (celular y PC, sin extensión). Hoy y mañana.
//  - Sofascore: con la extensión, cualquier día.
import * as provider from '../provider.js';
import { SPORTS } from '../sports.js';
import { addDays, flag, fmtDay, fmtTime, groupBy, h, limaToday } from '../util.js';
import { basicNorm } from '../analysis/matching.js';

const MAX_EXPANDED_ON_SEARCH = 60;

export class PartidosView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
  }

  render() {
    const { app } = this;
    const { state } = app;
    this.root.replaceChildren();
    this.root.append(this.sourceBar());
    if (state.source === 'sofascore' && !app.extOk) {
      this.chips = null;
      this.root.append(
        h(
          'div',
          { class: 'banner warn' },
          h('b', {}, 'Sofascore necesita la extensión "Análisis BDP - Conector". '),
          'Solo funciona en la PC (instrucciones en ',
          h('a', { href: 'https://github.com/LuisP11127/Analisis-BDP/tree/main/extension', target: '_blank', rel: 'noopener' }, 'extension/README.md'),
          '). En el celular usa la fuente Automático.',
        ),
      );
      return;
    }
    this.chips = h('div', { class: 'sports', role: 'tablist' });
    this.list = h('div', {});
    const search = h('input', {
      type: 'search',
      placeholder: 'Buscar equipo, liga o país',
      value: state.search,
      oninput: (e) => {
        state.search = e.target.value;
        this.renderList();
      },
    });
    const onlyPending = h('input', {
      type: 'checkbox',
      checked: state.onlyPending,
      onchange: (e) => {
        state.onlyPending = e.target.checked;
        this.renderList();
      },
    });
    const onlyOdds =
      state.source === 'auto'
        ? h(
            'label',
            { title: 'Solo los partidos con cuotas de Apuesta Total (los que se pueden analizar sin la extensión)' },
            h('input', {
              type: 'checkbox',
              checked: state.onlyOdds,
              onchange: (e) => {
                app.setOnlyOdds(e.target.checked);
                this.renderList();
              },
            }),
            'Solo con cuotas',
          )
        : null;
    const toolbar = h(
      'div',
      { class: 'toolbar' },
      search,
      h('label', {}, onlyPending, 'Solo por jugar'),
      onlyOdds,
      h('button', { class: 'btn small', onclick: () => this.expandAll(true) }, 'Abrir todo'),
      h('button', { class: 'btn small', onclick: () => this.expandAll(false) }, 'Cerrar todo'),
      h('button', { class: 'btn small', onclick: () => app.clearSelection() }, 'Quitar marcas'),
      h('button', { class: 'btn small ghost', onclick: () => app.loadSport(state.sport, { force: true }), title: 'Volver a pedir los partidos' }, '↻'),
    );
    this.root.append(this.chips, toolbar, this.list);
    this.renderChips();
    this.renderList();
  }

  // Selector de fuente y antigüedad de los datos automáticos.
  sourceBar() {
    const { app } = this;
    const { state } = app;
    const btn = (id, text, title, disabled = false) =>
      h('button', { class: state.source === id ? 'active' : '', title, disabled, onclick: () => state.source !== id && app.setSource(id) }, text);
    const data = state.events.get(app.eventsKey());
    const generated = data?.generated || provider.cachedIndex()?.generated;
    const info =
      state.source === 'auto'
        ? [
            'Flashscore + cuotas de Apuesta Total',
            generated ? ` · actualizado ${app.ago(generated)}` : '',
            app.extOk ? ' · al analizar, la extensión suma Betano y cuotas en vivo' : '',
          ].join('')
        : 'Partidos de Sofascore leídos por la extensión';
    return h(
      'div',
      { class: 'source-bar' },
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Fuente de los partidos' },
        btn('auto', 'Automático', 'Datos publicados cada 2 horas: funciona en el celular y en la PC'),
        btn('sofascore', 'Sofascore', app.extOk ? 'Partidos de Sofascore con la extensión' : 'Necesita la extensión (solo PC)', !app.extOk),
      ),
      h('span', { class: 'note' }, info),
    );
  }

  renderChips() {
    if (!this.chips) return;
    const { app } = this;
    const { state } = app;
    const selectedBySport = groupBy([...state.selected.values()], (e) => e.sport);
    // Automático: solo los deportes publicados para ese día, con cuántos partidos tienen cuotas.
    const published = state.source === 'auto' ? provider.cachedIndex()?.days?.[state.date] : null;
    const sports = published ? SPORTS.filter((s) => published[s.slug] || s.slug === state.sport) : SPORTS;
    this.chips.replaceChildren(
      ...sports.map((s) => {
        const data = state.events.get(app.eventsKey(s.slug));
        const info = published?.[s.slug];
        const n = info ? (state.onlyOdds ? info.withOdds : info.events) : data?.items?.length;
        const sel = selectedBySport.get(s.slug)?.length;
        return h(
          'button',
          { class: `sport${s.slug === state.sport ? ' active' : ''}`, onclick: () => app.loadSport(s.slug) },
          `${s.icon} ${s.name}`,
          n != null ? h('span', { class: 'n' }, n) : null,
          sel ? h('span', { class: 'sel' }, sel) : null,
        );
      }),
    );
  }

  visibleGroups() {
    const { state } = this.app;
    const data = state.events.get(this.app.eventsKey());
    if (!data?.items) return { data, groups: [] };
    let items = data.items;
    if (state.onlyPending) items = items.filter((e) => e.state === 'pendiente' || e.state === 'en_vivo' || state.selected.has(e.id));
    if (state.source === 'auto' && state.onlyOdds && data.withOdds) items = items.filter((e) => data.withOdds.has(e.id) || state.selected.has(e.id));
    const q = basicNorm(state.search);
    if (q) {
      items = items.filter((e) =>
        basicNorm(`${e.home.name} ${e.away.name} ${e.tournament.name} ${e.category.name}`).includes(q),
      );
    }
    const groups = [...groupBy(items, (e) => `${e.category.name}|${e.tournament.id}`).entries()]
      .map(([key, events]) => ({ key, events: events.sort((a, b) => a.start - b.start), first: events[0] }))
      .sort(
        (a, b) =>
          (b.first.tournament.priority || 0) - (a.first.tournament.priority || 0) ||
          a.first.category.name.localeCompare(b.first.category.name) ||
          a.first.tournament.name.localeCompare(b.first.tournament.name),
      );
    return { data, groups };
  }

  expandAll(open) {
    const { groups } = this.visibleGroups();
    const { expanded } = this.app.state;
    for (const g of groups) open ? expanded.add(g.key) : expanded.delete(g.key);
    this.renderList();
  }

  renderList() {
    const { app } = this;
    const { state } = app;
    const { data, groups } = this.visibleGroups();
    this.list.replaceChildren();
    if (!data || data.status === 'loading') {
      this.list.append(
        state.source === 'auto'
          ? h('div', { class: 'empty' }, 'Cargando partidos…')
          : h(
              'div',
              { class: 'empty' },
              'Cargando partidos de Sofascore…',
              h('div', { class: 'note' }, 'Si su API no responde, la extensión abre Sofascore en una pestaña y lee los partidos de la web; puede tardar unos 30 segundos.'),
            ),
      );
      return;
    }
    if (data.status === 'nodata') {
      this.list.append(this.noData(data.index));
      return;
    }
    if (data.status === 'error') {
      this.list.append(
        h(
          'div',
          { class: 'banner warn' },
          h('b', {}, 'No se pudieron cargar los partidos. '),
          data.error,
          ' ',
          h('button', { class: 'btn small', onclick: () => app.loadSport(state.sport, { force: true }) }, 'Reintentar'),
        ),
      );
      return;
    }
    if (!groups.length) {
      const hiddenByOdds = state.source === 'auto' && state.onlyOdds && data.items.length > 0;
      this.list.append(
        h(
          'div',
          { class: 'empty' },
          state.search ? 'Nada coincide con la búsqueda.' : hiddenByOdds ? 'Ningún partido de este día tiene cuotas publicadas todavía.' : 'No hay partidos para este día.',
          hiddenByOdds && !state.search
            ? h('div', {}, h('button', { class: 'btn small', onclick: () => (app.setOnlyOdds(false), this.render()) }, 'Ver todos los partidos'))
            : null,
        ),
      );
      return;
    }
    const searching = Boolean(state.search.trim());
    groups.forEach((g, i) => {
      const open = state.expanded.has(g.key) || (searching && i < MAX_EXPANDED_ON_SEARCH) || g.events.some((e) => state.selected.has(e.id));
      this.list.append(this.league(g, open));
    });
  }

  // El día elegido no está en los datos automáticos (solo hay hoy y mañana).
  noData(index) {
    const { app } = this;
    if (!index) {
      return h(
        'div',
        { class: 'banner warn' },
        h('b', {}, 'Los datos automáticos todavía no están publicados. '),
        'GitHub Actions los actualiza cada 2 horas; vuelve a intentar en unos minutos.',
      );
    }
    const dates = Object.keys(index.days || {}).sort();
    if (dates.includes(app.state.date)) return h('div', { class: 'empty' }, 'No hay partidos de este deporte para este día.');
    const today = limaToday();
    return h(
      'div',
      { class: 'empty' },
      'Los datos automáticos cubren hoy y mañana.',
      h(
        'div',
        { class: 'toolbar', style: 'justify-content:center;margin-top:10px' },
        dates.map((d) => h('button', { class: 'btn small', onclick: () => app.setDate(d) }, d === today ? 'Hoy' : d === addDays(today, 1) ? 'Mañana' : fmtDay(d))),
      ),
      h('div', { class: 'note' }, app.extOk ? 'Para otros días elige la fuente Sofascore.' : 'Para otros días usa la fuente Sofascore en la PC con la extensión.'),
    );
  }

  league(g, open) {
    const { app } = this;
    const selectable = g.events.filter((e) => e.state === 'pendiente');
    const nSel = selectable.filter((e) => app.state.selected.has(e.id)).length;
    const check = h('input', {
      type: 'checkbox',
      'aria-label': `Marcar ${g.first.tournament.name}`,
      disabled: !selectable.length,
      checked: selectable.length > 0 && nSel === selectable.length,
      onchange: (e) => app.toggle(selectable, e.target.checked),
    });
    check.indeterminate = nSel > 0 && nSel < selectable.length;
    const title = h(
      'button',
      {
        class: 'league-title',
        onclick: () => {
          app.state.expanded.has(g.key) ? app.state.expanded.delete(g.key) : app.state.expanded.add(g.key);
          this.renderList();
        },
      },
      h('span', {}, flag(g.first.category.alpha2)),
      h('span', { class: 'country' }, g.first.category.name),
      h('span', { class: 'name' }, g.first.tournament.name),
    );
    const head = h('div', { class: 'league-head' }, check, title, h('span', { class: 'count' }, `${nSel ? `${nSel}/` : ''}${g.events.length}`));
    const box = h('div', { class: 'league' }, head);
    if (open) box.append(h('div', { class: 'matches' }, g.events.map((e) => this.match(e))));
    return box;
  }

  match(e) {
    const { app } = this;
    const selectable = e.state === 'pendiente';
    const selected = app.state.selected.has(e.id);
    const live = e.state === 'en_vivo';
    const stateText =
      e.state === 'pendiente' ? '' : live ? 'EN VIVO' : e.state === 'finalizado' ? 'Final' : e.statusText || e.state;
    const withOdds = app.state.events.get(app.eventsKey())?.withOdds;
    const oddsBadge = selectable && withOdds?.has(e.id) ? h('span', { class: 'odds-badge', title: 'Tiene cuotas de Apuesta Total' }, 'cuotas') : stateText;
    const row = h(
      'label',
      { class: `match${selectable ? '' : ' disabled'}${selected ? ' selected' : ''}` },
      h('input', { type: 'checkbox', disabled: !selectable, checked: selected, onchange: (ev) => app.toggle([e], ev.target.checked) }),
      h('span', { class: 'time' }, fmtTime(e.start)),
      h('span', { class: 'teams' }, h('span', {}, e.home.name), h('span', {}, e.away.name)),
      h(
        'span',
        { class: 'score' },
        e.score ? [h('span', {}, e.score.home), h('span', {}, e.score.away)] : h('span', { class: `state${live ? ' live' : ''}` }, oddsBadge),
      ),
      e.url
        ? h('a', { href: e.url, target: '_blank', rel: 'noopener', title: e.url.includes('flashscore') ? 'Ver en Flashscore' : 'Ver en Sofascore', onclick: (ev) => ev.stopPropagation() }, '↗')
        : h('span', {}),
    );
    return row;
  }
}
