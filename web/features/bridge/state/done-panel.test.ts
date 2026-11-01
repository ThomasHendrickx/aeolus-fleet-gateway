import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RecordItem, RecordPage } from '../services/items';
import { DonePanel } from './done-panel';

function anItem(overrides: Partial<RecordItem> = {}): RecordItem {
  return { deliveryId: 'dlv_01', from: 'watch', title: 'builder-gateway: no report change for 2 h', sentAt: '2026-10-31T19:47:00.000Z', job: 'stay-aware', state: 'done', outcome: { place: 'bridge', kind: 'seen', option: null, at: '2026-10-31T19:49:00.000Z' }, ...overrides };
}

function render(first: RecordPage): string {
  return renderToStaticMarkup(createElement(DonePanel, { fleetId: 'flt_01', first }));
}

describe('Done (Bridge, CC4)', () => {
  it('lists each item with what came of it and where', () => {
    const markup = render({ items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'decide', from: 'orchestrator-1', title: 'Which goes first?', outcome: { place: 'slack', kind: 'answered', option: 2, at: '2026-10-31T19:58:00.000Z' } })], nextCursor: null });

    expect([markup.includes('Seen in Bridge'), markup.includes('Answered in Slack: option 2')]).toEqual([true, true]);
  });

  it('opens an item not done yet, and none that is done', () => {
    const markup = render({ items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'everything-else', state: 'seen', outcome: null })], nextCursor: null });

    expect((markup.match(/data-testid="bridge-open"/g) ?? []).length).toBe(1);
  });

  it('offers older items only while the record has more', () => {
    expect([render({ items: [anItem()], nextCursor: 'dlv_01' }).includes('Show older'), render({ items: [anItem()], nextCursor: null }).includes('Show older')]).toEqual([true, false]);
  });
});
