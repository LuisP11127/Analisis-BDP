// Pestaña "Partidos": deportes de Sofascore, ligas y partidos del día con
// casillas para marcar ligas completas o partidos sueltos.
import { SPORTS } from '../sports.js';
import { flag, fmtTime, groupBy, h } from '../util.js';
import { basicNorm } from '../analysis/matching.js';

const MAX_EXPANDED_ON_SEARCH = 60;

export class PartidosView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
  }

  render() {
    const { app } = this;
    this.root.replaceChildren();
    if (!app.extOk) {
      this.root.append(
        h(
          'div',
          { class: 'banner warn' },
          h('b', {}, 'Instala la extensión "Análisis BDP - Conector" para ver los partidos. '),
          'Sofascore solo responde desde tu navegador. Instrucciones en ',
          h('a', { href: 'https://github.com/LuisP11127/Analisis-BDP/tree/main/extension', target: '_blank', rel: 'noopener' }, 'extension/README.md'),
          '. Sin la extensión puedes ver el historial guardado.',
        ),
      );
      return;
    }
    this.chips = h('div', { class: 'sports', role: 'tablist' });
    this.list = h('div', {});
    const search = h('input', {
      type: 'search',
      placeholder: 'Buscar equipo, liga o país',
      value: app.state.search,
      oninput: (e) => {
        app.state.search = e.target.value;
        this.renderList();
      },
    });
    const onlyPending = h('input', {
      type: 'checkbox',
      checked: app.state.onlyPending,
      onchange: (e) => {
        app.state.onlyPending = e.target.checked;
        this.renderList();
      },
    });
    const toolbar = h(
      'div',
      { class: 'toolbar' },
      search,
      h('label', {}, onlyPending, 'Solo por jugar'),
      h('button', { class: 'btn small', onclick: () => this.expandAll(true) }, 'Abrir todo'),
      h('button', { class: 'btn small', onclick: () => this.expandAll(false) }, 'Cerrar todo'),
      h('button', { class: 'btn small', onclick: () => app.clearSelection() }, 'Quitar marcas'),
      h('button', { class: 'btn small ghost', onclick: () => app.loadSport(app.state.sport, { force: true }), title: 'Volver a pedir los partidos' }, '↻'),
    );
    this.root.append(this.chips, toolbar, this.list);
    this.renderChips();
    this.renderList();
  }

  renderChips() {
    if (!this.chips) return;
    const { state } = this.app;
    const selectedBySport = groupBy([...state.selected.values()], (e) => e.sport);
    this.chips.replaceChildren(
      ...SPORTS.map((s) => {
        const data = state.events.get(`${state.date}|${s.slug}`);
        const n = data?.items?.length;
        const sel = selectedBySport.get(s.slug)?.length;
        return h(
          'button',
          { class: `sport${s.slug === state.sport ? ' active' : ''}`, onclick: () => this.app.loadSport(s.slug) },
          `${s.icon} ${s.name}`,
          n != null ? h('span', { class: 'n' }, n) : null,
          sel ? h('span', { class: 'sel' }, sel) : null,
        );
      }),
    );
  }

  visibleGroups() {
    const { state } = this.app;
    const data = state.events.get(`${state.date}|${state.sport}`);
    if (!data?.items) return { data, groups: [] };
    let items = data.items;
    if (state.onlyPending) items = items.filter((e) => e.state === 'pendiente' || e.state === 'en_vivo' || state.selected.has(e.id));
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
        h(
          'div',
          { class: 'empty' },
          'Cargando partidos de Sofascore…',
          h('div', { class: 'note' }, 'Si su API no responde, la extensión abre Sofascore en una pestaña y lee los partidos de la web; puede tardar unos 30 segundos.'),
        ),
      );
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
      this.list.append(h('div', { class: 'empty' }, state.search ? 'Nada coincide con la búsqueda.' : 'No hay partidos para este día.'));
      return;
    }
    const searching = Boolean(state.search.trim());
    groups.forEach((g, i) => {
      const open = state.expanded.has(g.key) || (searching && i < MAX_EXPANDED_ON_SEARCH) || g.events.some((e) => state.selected.has(e.id));
      this.list.append(this.league(g, open));
    });
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
    const row = h(
      'label',
      { class: `match${selectable ? '' : ' disabled'}${selected ? ' selected' : ''}` },
      h('input', { type: 'checkbox', disabled: !selectable, checked: selected, onchange: (ev) => app.toggle([e], ev.target.checked) }),
      h('span', { class: 'time' }, fmtTime(e.start)),
      h('span', { class: 'teams' }, h('span', {}, e.home.name), h('span', {}, e.away.name)),
      h(
        'span',
        { class: 'score' },
        e.score ? [h('span', {}, e.score.home), h('span', {}, e.score.away)] : h('span', { class: `state${live ? ' live' : ''}` }, stateText),
      ),
      e.url
        ? h('a', { href: e.url, target: '_blank', rel: 'noopener', title: 'Ver en Sofascore', onclick: (ev) => ev.stopPropagation() }, '↗')
        : h('span', {}),
    );
    return row;
  }
}
