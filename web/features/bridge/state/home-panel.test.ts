import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeHome, HomeItem } from '../services/items';
import { HomePanel } from './home-panel';
import { AsLastRead } from './kept-read';

function anItem(overrides: Partial<HomeItem> = {}): HomeItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first: the Compact look (U4) or Harbour?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', state: 'new', stale: null, inBasket: null, ...overrides };
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

  it('shows a withdrawn question stale, outside the count: struck through, with when it was withdrawn and its icon, not faded', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_02', title: 'Hold PR #1488?' }), anItem({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T20:09:00.000Z', replacementTitle: null } })] }, stayAware: [] });

    expect({
      counts: markup.includes('1 to decide, 0 to do.'),
      stale: markup.includes('Withdrawn by orchestrator-1 at 20:09 UTC: open it to clear it'),
      struck: /<s[^>]*>Which goes first: the Compact look \(U4\) or Harbour\?<\/s>/.test(markup),
      icon: markup.includes('aria-label="Withdrawn"'),
      faded: markup.includes('opacity-60'),
      marked: (markup.match(/data-testid="bridge-item" data-stale="true"/g) ?? []).length,
    }).toEqual({ counts: true, stale: true, struck: true, icon: true, faded: false, marked: 1 });
  });

  it('links a replaced question to its replacement, the new item', () => {
    const markup = render({
      waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_03', title: 'Which goes first, now that U4 slipped?' }), anItem({ stale: { kind: 'replaced', replacementId: 'dlv_03', at: '2026-10-31T20:10:00.000Z', replacementTitle: 'Which goes first, now that U4 slipped?' } })] },
      stayAware: [],
    });

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 20:10 UTC with “Which goes first, now that U4 slipped?”'), icon: markup.includes('aria-label="Replaced"'), link: (markup.match(/data-testid="bridge-replacement"/g) ?? []).length }).toEqual({ stale: true, icon: true, link: 1 });
  });

  it('links a replaced step to its replacement, the new step', () => {
    const markup = render({
      waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_03', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory' }), anItem({ job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', stale: { kind: 'replaced', replacementId: 'dlv_03', at: '2026-10-31T20:11:00.000Z', replacementTitle: 'Create the GitHub repository aeolus-fleet-memory' } })] },
      stayAware: [],
    });

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 20:11 UTC with “Create the GitHub repository aeolus-fleet-memory”'), struck: /<s[^>]*>Create the GitHub repository aeolus-fleet-memory-plugin<\/s>/.test(markup), link: markup.includes('Open the new step') }).toEqual({ stale: true, struck: true, link: true });
  });

  it('says on its row that a question is in the basket with the note alone', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ state: 'seen', inBasket: { option: null, note: 'Ask me after the demo.' } })] }, stayAware: [] });

    expect(markup.includes('In the basket: the note alone')).toBe(true);
  });

  it('says on its row that a question is in the basket with its option, still counted (section 9, rule 1)', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ state: 'seen', inBasket: { option: 2, note: null } })] }, stayAware: [] });

    expect({ inBasket: markup.includes('In the basket: option 2'), seen: markup.includes('Seen, not done yet'), count: markup.includes('data-testid="bridge-count" class="text-tone-waiting-fg">1<') }).toEqual({ inBasket: true, seen: false, count: true });
  });
});

describe('Bridge home as last read, while the record cannot be read (states.html)', () => {
  const home: BridgeHome = {
    waiting: { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin' })] },
    stayAware: [anItem({ deliveryId: 'dlv_03', job: 'stay-aware', from: 'watch', title: 'builder-gateway: no report change for 2 h' })],
  };
  const markup = renderToStaticMarkup(createElement(AsLastRead, { at: '2026-10-31T20:14:00.000Z', children: createElement(HomePanel, { fleetId: 'flt_01', home }) }));

  it('says when it was last read under the title, in place of the count', () => {
    expect({
      title: /<h1[^>]*>Waiting on you<\/h1>/.test(markup),
      lastRead: markup.includes('data-testid="bridge-last-read">Last read 20:14 UTC<'),
      count: markup.includes('data-testid="bridge-count"'),
    }).toEqual({ title: true, lastRead: true, count: false });
  });

  it('shows what waited as last read, faded and not to be opened, saying so under it', () => {
    expect({
      rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length,
      faded: /<ul[^>]*inert=""[^>]*class="[^"]*opacity-60/.test(markup),
      open: markup.includes('data-testid="bridge-open"'),
      shown: markup.includes('Shown as last read, at 20:14 UTC.'),
    }).toEqual({ rows: 2, faded: true, open: false, shown: true });
  });

  it('leaves out the stay-aware feed and sending a ship a message', () => {
    expect({ feed: markup.includes('builder-gateway: no report change for 2 h'), send: markup.includes('data-testid="bridge-send-message"') }).toEqual({ feed: false, send: false });
  });
});
