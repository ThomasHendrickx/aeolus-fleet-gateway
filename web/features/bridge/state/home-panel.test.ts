import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeHome, HomeItem } from '../services/items';
import { HomePanel } from './home-panel';

function anItem(overrides: Partial<HomeItem> = {}): HomeItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first: the Compact look (U4) or Harbour?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', state: 'new', ...overrides };
}

function render(home: BridgeHome): string {
  return renderToStaticMarkup(createElement(HomePanel, { fleetId: 'flt_01', home }));
}

describe('Bridge home (CC18)', () => {
  it('shows what waits with its count, each item to decide or do with who asked', () => {
    const markup = render({
      waiting: { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', state: 'seen' })] },
      stayAware: [],
    });

    expect({
      count: markup.includes('data-testid="bridge-count" class="text-tone-waiting-fg">2<'),
      counts: markup.includes('1 to decide, 1 to do.'),
      rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length,
      seen: markup.includes('Seen, not done yet'),
    }).toEqual({ count: true, counts: true, rows: 2, seen: true });
  });

  it('marks a new item with a dot, and not one the person saw', () => {
    const markup = render({ waiting: { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', state: 'seen' })] }, stayAware: [] });

    expect((markup.match(/aria-label="New"/g) ?? []).length).toBe(1);
  });

  it('shows the alerts and notices not seen in the feed, outside the count', () => {
    const markup = render({ waiting: { count: 0, items: [] }, stayAware: [anItem({ deliveryId: 'dlv_03', job: 'stay-aware', from: 'watch', title: 'builder-gateway: no report change for 2 h' })] });

    expect({ feed: markup.includes('builder-gateway: no report change for 2 h'), outside: markup.includes('1 unseen, outside the count') }).toEqual({ feed: true, outside: true });
  });

  it('says nothing waits, and nothing new reached the person, when nothing does', () => {
    const markup = render({ waiting: { count: 0, items: [] }, stayAware: [] });

    expect({ nothingWaits: markup.includes('data-testid="bridge-nothing-waits"'), nothingNew: markup.includes('Nothing new. What you saw is in Done.') }).toEqual({ nothingWaits: true, nothingNew: true });
  });
});
