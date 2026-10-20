import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL, buildBets, mergeWallets, newWallet, pendingLegs, settleBet, settleWallet, walletSummary } from '../docs/js/bets.js';

const now = Date.parse('2026-10-20T12:00:00Z');
const sel = (eventId, market, sel, price, start = now + 3600000) => ({ eventId, sport: 'football', start, match: `Local ${eventId} vs Visita ${eventId}`, market, sel, line: null, label: `${market} ${sel}`, price, source: 'betano' });

test('apuestas demo: saldo inicial de S/ 10 000', () => {
  assert.equal(INITIAL, 10000);
  const s = walletSummary(newWallet(now));
  assert.equal(s.balance, 10000);
  assert.equal(walletSummary(null).balance, 10000);
});

test('apuestas demo: simples y combinadas con sus validaciones', () => {
  const a = sel('a', '1X2', 'home', 1.8);
  const b = sel('b', 'OU', 'over', 2.1);
  const simple = buildBets([a, b], { kind: 'simple', stakes: [100, 50] }, 10000, now);
  assert.deepEqual(simple.errors, []);
  assert.equal(simple.bets.length, 2);
  assert.equal(simple.total, 150);
  assert.equal(simple.bets[0].odds, 1.8);

  const combo = buildBets([a, b], { kind: 'combinada', stake: 20 }, 10000, now);
  assert.deepEqual(combo.errors, []);
  assert.equal(combo.bets.length, 1);
  assert.ok(Math.abs(combo.bets[0].odds - 1.8 * 2.1) < 1e-9);
  assert.ok(combo.bets[0].legs.every((l) => l.status === 'pending'));

  const sameMatch = buildBets([a, sel('a', 'OU', 'over', 1.5)], { kind: 'combinada', stake: 20 }, 10000, now);
  assert.match(sameMatch.errors.join(), /mismo partido/);
  assert.equal(sameMatch.bets.length, 0);
  assert.match(buildBets([a], { kind: 'combinada', stake: 20 }, 10000, now).errors.join(), /al menos 2/);
  assert.match(buildBets([a], { kind: 'simple', stakes: [0.5] }, 10000, now).errors.join(), /mínimo/);
  assert.match(buildBets([a], { kind: 'simple', stakes: [200] }, 150, now).errors.join(), /Saldo insuficiente/);
  assert.match(buildBets([sel('c', '1X2', 'home', 1.5, now - 60000)], { kind: 'simple', stakes: [10] }, 10000, now).errors.join(), /ya empezó/);
});

test('apuestas demo: pagos de simples, medias apuestas y combinadas', () => {
  const simple = (status, price = 2, stake = 100) => settleBet({ kind: 'simple', stake, legs: [{ status, price }] });
  assert.deepEqual(simple('won'), { status: 'won', payout: 200 });
  assert.deepEqual(simple('lost'), { status: 'lost', payout: 0 });
  assert.deepEqual(simple('void'), { status: 'void', payout: 100 });
  assert.deepEqual(simple('half_won'), { status: 'half_won', payout: 150 });
  assert.deepEqual(simple('half_lost'), { status: 'half_lost', payout: 50 });
  assert.deepEqual(simple('pending'), { status: 'pending', payout: null });

  const combo = (statuses) => settleBet({ kind: 'combinada', stake: 10, legs: statuses.map((status, i) => ({ status, price: [2, 3, 1.5][i] })) });
  assert.deepEqual(combo(['won', 'won', 'won']), { status: 'won', payout: 90 });
  assert.deepEqual(combo(['won', 'lost', 'pending']), { status: 'lost', payout: 0 });
  assert.deepEqual(combo(['won', 'pending', 'won']), { status: 'pending', payout: null });
  assert.deepEqual(combo(['won', 'void', 'won']), { status: 'won', payout: 30 }, 'la anulada cuenta como cuota 1');
  assert.deepEqual(combo(['void', 'void', 'void']), { status: 'void', payout: 10 });
});

test('apuestas demo: saldo, liquidación y unión de copias de la billetera', () => {
  const w = newWallet(now);
  const { bets } = buildBets([sel('a', '1X2', 'home', 2), sel('b', '1X2', 'away', 3)], { kind: 'simple', stakes: [100, 100] }, 10000, now);
  w.bets.push(...bets);
  assert.equal(walletSummary(w).balance, 9800);
  assert.equal(walletSummary(w).openCount, 2);
  assert.equal(pendingLegs(w).length, 2);

  // Otra copia (p. ej. la de GitHub antes de reflejar el último cambio) sin la segunda apuesta.
  const stale = { ...w, bets: [structuredClone(w.bets[0])] };
  pendingLegs(w)[0].status = 'won';
  pendingLegs(w)[0].status = 'lost'; // la segunda (la primera ya no está pendiente)
  assert.equal(settleWallet(w), 2);
  const merged = mergeWallets(stale, w);
  assert.equal(merged.bets.length, 2, 'no se pierden apuestas');
  assert.equal(merged.bets[0].status, 'won', 'vale la versión liquidada');
  const s = walletSummary(merged);
  assert.equal(s.balance, 10000 - 200 + 200);
  assert.equal(s.won, 1);
  assert.equal(s.lost, 1);
  assert.equal(s.profit, 0);
  // Una billetera reiniciada (otro id) no se mezcla con la anterior.
  const other = newWallet(now + 1);
  assert.equal(mergeWallets(other, w).bets.length, 0);
});

test('apuestas demo: mercados agrupados como en la casa', async () => {
  const { mainOdds, marketPanels, selectionOf, shortLabel, tabName } = await import('../docs/js/sportsbook.js');
  const ev = { id: 'fs:x', sport: 'football', start: now + 3600000, home: { name: 'Alianza Lima' }, away: { name: 'Universitario' }, tournament: { name: 'Liga 1' }, url: 'u' };
  const o = (market, sel, line, price, name) => ({ source: 'betano', market, sel, line, price, group: `betano|${name}|${line ?? ''}` });
  const offers = [
    o('1X2', 'home', null, 2.1, 'Resultado Final'),
    o('1X2', 'draw', null, 3.2, 'Resultado Final'),
    o('1X2', 'away', null, 3.5, 'Resultado Final'),
    o('OU', 'over', 2.5, 1.9, 'Total de Goles'),
    o('OU', 'under', 2.5, 1.9, 'Total de Goles'),
    o('OU', 'over', 1.5, 1.3, 'Total de Goles'),
    o('OU', 'under', 1.5, 3.4, 'Total de Goles'),
    o('OU.corners', 'over', 9.5, 1.85, 'Córners Más/Menos'),
    o('OU.corners', 'under', 9.5, 1.95, 'Córners Más/Menos'),
    o('1X2@h1', 'home', null, 2.6, '1.ª Mitad - Resultado'),
  ];
  const panels = marketPanels(offers, ev);
  assert.deepEqual(panels.map((p) => p.title), ['Resultado Final', 'Total de Goles', '1.ª Mitad - Resultado', 'Córners Más/Menos']);
  assert.deepEqual(panels.map((p) => tabName(p.tab, 'football')), ['Principales', 'Goles', 'Mitades', 'Córners']);
  const goals = panels[1];
  assert.deepEqual(goals.rows.map((r) => r.map((x) => shortLabel(x, ev))), [['Más de 1.5', 'Menos de 1.5'], ['Más de 2.5', 'Menos de 2.5']], 'una fila por línea');
  assert.deepEqual(panels[0].rows[0].map((x) => shortLabel(x, ev)), ['Alianza Lima', 'Empate', 'Universitario']);
  assert.deepEqual(mainOdds(offers).map((x) => x.price), [2.1, 3.2, 3.5]);
  const s = selectionOf({ ev }, offers[3], 'Total de Goles');
  assert.equal(s.label, 'Más de 2.5 goles');
  assert.equal(s.match, 'Alianza Lima vs Universitario');
  assert.equal(s.price, 1.9);
});
