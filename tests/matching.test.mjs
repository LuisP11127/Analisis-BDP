import assert from 'node:assert/strict';
import test from 'node:test';
import { bestByName, matchEvent, similarity } from '../docs/js/analysis/matching.js';

test('reconoce el mismo equipo con nombres distintos', () => {
  assert.ok(similarity('CA Independiente', 'Independiente') >= 0.85);
  assert.ok(similarity('Instituto AC Cordoba', 'Instituto') >= 0.85);
  assert.ok(similarity('Bélgica', 'Belgium') === 1);
  assert.ok(similarity('Turquía', 'Türkiye') === 1);
  assert.ok(similarity('Países Bajos', 'Netherlands') === 1);
  assert.ok(similarity('Manchester Utd', 'Manchester United') >= 0.85);
  assert.ok(similarity('Club Universitario de Deportes', 'Universitario') >= 0.85);
  assert.ok(similarity('Carlos Alcaraz', 'C. Alcaraz') === 1);
  assert.ok(similarity('Carlos Alcaraz', 'Alcaraz C.') === 1);
});

test('no confunde equipos distintos ni categorías', () => {
  assert.ok(similarity('Manchester United', 'Manchester City') < 0.6);
  assert.equal(similarity('Belgium W', 'Belgium'), 0);
  assert.equal(similarity('Barcelona B', 'Barcelona'), 0);
  assert.equal(similarity('Peru U20', 'Peru'), 0);
  assert.ok(similarity('Real Madrid', 'Real Sociedad') < 0.6);
});

const sofa = { id: 9, start: Date.parse('2026-10-02T20:15:00Z'), home: { name: 'Independiente' }, away: { name: 'Instituto' } };

test('empareja por hora y nombres, y detecta equipos invertidos', () => {
  const list = [
    { eventId: 'a', start: Date.parse('2026-10-02T20:15:00Z'), home: 'River Plate', away: 'Boca Juniors' },
    { eventId: 'b', start: Date.parse('2026-10-02T20:15:00Z'), home: 'CA Independiente', away: 'Instituto AC Cordoba' },
    { eventId: 'c', start: Date.parse('2026-10-03T20:15:00Z'), home: 'CA Independiente', away: 'Instituto AC Cordoba' },
  ];
  assert.equal(matchEvent(sofa, list).item.eventId, 'b');
  const swapped = [{ eventId: 'd', start: sofa.start, home: 'Instituto AC Cordoba', away: 'CA Independiente' }];
  const m = matchEvent(sofa, swapped);
  assert.equal(m.item.eventId, 'd');
  assert.equal(m.swapped, true);
  assert.equal(matchEvent(sofa, [list[2]]), null, 'otro día no debe emparejar');
});

test('busca equipos de Understat por nombre', () => {
  const items = [{ team: 'Manchester United' }, { team: 'Manchester City' }, { team: 'Wolverhampton Wanderers' }];
  assert.equal(bestByName('Manchester United', items).team, 'Manchester United');
  assert.equal(bestByName('Wolverhampton', items).team, 'Wolverhampton Wanderers');
  assert.equal(bestByName('Liverpool', items), null);
});
