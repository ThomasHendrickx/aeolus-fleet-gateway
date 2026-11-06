import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RecordItem, RecordPage } from '../services/items';
import { DonePanel } from './done-panel';

// Done (done.html): every done item, under its day, with its clock time and
// what came of it and where on a line of its own. A done item opens by its
// title and is read back whole, with nothing acknowledged.

function anItem(overrides: Partial<RecordItem> = {}): RecordItem {
  return { deliveryId: 'dlv_01', from: 'watch', fromShipId: 'shp_01', title: 'builder-gateway: no report change for 2 h', sentAt: '2026-10-31T19:47:00.000Z', job: 'stay-aware', isAlert: true, state: 'done', places: [], contentType: 'application/vnd.aeolus.alert+json', payload: '{}', outcome: { place: 'bridge', kind: 'seen', option: null, optionLabel: null, note: null, seen: null, replacementTitle: null, at: '2026-10-31T19:49:00.000Z' }, ...overrides };
}

function render(first: RecordPage): string {
  return renderToStaticMarkup(createElement(DonePanel, { fleetId: 'flt_01', first, now: '2026-10-31T20:00:00.000Z' }));
}

describe('Done (done.html)', () => {
  it('keeps its list to a reading column, not the window, as the #242 mockups draw it', () => {
    expect(/<section class="[^"]*max-w-\[44rem\]/.test(render({ items: [anItem()], nextCursor: null }))).toBe(true);
  });

  it('says what came of each item and where, on a line of its own', () => {
    const answered = anItem({ deliveryId: 'dlv_02', job: 'decide', isAlert: false, from: 'orchestrator-1', title: 'Which goes first?', outcome: { place: 'slack', kind: 'answered', option: 2, optionLabel: 'Harbour first', note: null, seen: null, replacementTitle: null, at: '2026-10-31T19:58:00.000Z' } });

    const markup = render({ items: [answered, anItem()], nextCursor: null });

    expect((markup.match(/data-testid="bridge-done-outcome"/g) ?? []).length).toBe(2);
    expect([markup.includes('Seen in Bridge'), markup.includes('Answered in Slack: option 2, Harbour first')]).toEqual([true, true]);
  });

  it('groups items under the day they were done, each with the time of day it was done', () => {
    const doneLater = anItem({ sentAt: '2026-10-31T18:00:00.000Z', outcome: { place: 'bridge', kind: 'seen', option: null, optionLabel: null, note: null, seen: null, replacementTitle: null, at: '2026-10-31T19:49:00.000Z' } });
    const endedByTheFleet = anItem({ deliveryId: 'dlv_02', sentAt: '2026-10-29T09:12:00.000Z', outcome: null });

    const markup = render({ items: [doneLater, endedByTheFleet], nextCursor: null });

    expect([markup.includes('>Today<'), markup.includes('>29 Oct<'), markup.includes('>19:49<'), markup.includes('>18:00<'), markup.includes('>09:12<')]).toEqual([true, true, true, false, true]);
  });

  it('opens a done item by its title, with no Open button beside it', () => {
    const markup = render({ items: [anItem()], nextCursor: null });

    expect([markup.includes('data-testid="bridge-item-title"') && markup.includes('<button type="button" data-testid="bridge-item-title"'), markup.includes('data-testid="bridge-open"')]).toEqual([true, false]);
  });

  it('says opening one reads it back whole', () => {
    expect(render({ items: [anItem()], nextCursor: null })).toContain('Everything that reached you, with what came of it and where. Opening one reads it back whole.');
  });

  it('offers older items only while the record has more', () => {
    expect([render({ items: [anItem()], nextCursor: 'dlv_01' }).includes('Show older'), render({ items: [anItem()], nextCursor: null }).includes('Show older')]).toEqual([true, false]);
  });
});
