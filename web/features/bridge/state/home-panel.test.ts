import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeHome, HomeItem } from '../services/items';
import type { ItemOpening } from './item-focus';
import { HomeLists, HomePanel } from './home-panel';

function anItem(overrides: Partial<HomeItem> = {}): HomeItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first: the Compact look (U4) or Harbour?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', isAlert: false, state: 'new', stale: null, inBasket: null, seenIn: null, places: [], actInPlace: null, ...overrides };
}

/** When the page read Bridge home: the items' ages are from it. */
const NOW = '2026-10-31T20:00:00.000Z';

function render(home: BridgeHome): string {
  return renderToStaticMarkup(createElement(HomePanel, { fleetId: 'flt_01', home, now: NOW }));
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
      seen: markup.includes('>Seen<'),
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

describe('Bridge home: each row as the mockups draw it (aeolus-fleet#1535)', () => {
  it('says the job in its word, who asked, and how long ago, with no full date', () => {
    const markup = render({ waiting: { count: 1, items: [anItem()] }, stayAware: [] });

    expect({ word: markup.includes('text-tone-active-fg">Decide<'), from: markup.includes('>orchestrator-1<'), age: markup.includes('>12 min<'), date: markup.includes('2026-10-31 19:48 UTC<') }).toEqual({ word: true, from: true, age: true, date: false });
  });

  it('names the places that show an item, Bridge first', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ places: ['slack', 'chat'] })] }, stayAware: [] });

    expect(markup.includes('aria-label="Shows in Bridge, Slack and a chat"')).toBe(true);
  });

  it("offers to put the asker's pick in the basket beside Open on a question still new", () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ actInPlace: { kind: 'putPick', option: 1 } })] }, stayAware: [] });

    expect({ put: markup.includes('Put option 1 in the basket'), open: (markup.match(/data-testid="bridge-open"/g) ?? []).length }).toEqual({ put: true, open: 1 });
  });

  it('leads a step to its link by its host, beside Open', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ job: 'do', actInPlace: { kind: 'openLink', href: 'https://github.com/new', host: 'github.com' } })] }, stayAware: [] });

    expect({ link: markup.includes('href="https://github.com/new"'), host: markup.includes('Open github.com'), open: (markup.match(/data-testid="bridge-open"/g) ?? []).length }).toEqual({ link: true, host: true, open: 1 });
  });

  it("shows the gateway's own step as its action alone, where the gateway finishes it", () => {
    const markup = render({
      waiting: { count: 1, items: [anItem({ job: 'do', from: 'gateway', state: 'seen', title: 'Sign in to the outside party linear', actInPlace: { kind: 'ownStep', href: 'https://gateway.example.com/outside-parties/linear', label: 'Sign in to linear' } })] },
      stayAware: [],
    });

    expect({ action: markup.includes('href="https://gateway.example.com/outside-parties/linear"'), open: markup.includes('data-testid="bridge-open"') }).toEqual({ action: true, open: false });
  });

  it('shows an alert and a notice by their words, with no button: the title opens each', () => {
    const markup = render({
      waiting: { count: 0, items: [] },
      stayAware: [anItem({ deliveryId: 'dlv_03', job: 'stay-aware', isAlert: true, from: 'watch' }), anItem({ deliveryId: 'dlv_04', job: 'stay-aware', from: 'builder-core' })],
    });

    expect({
      alert: markup.includes('text-tone-attention-fg">Alert<'),
      notice: markup.includes('>Notice<'),
      open: markup.includes('data-testid="bridge-open"'),
      titles: (markup.match(/data-testid="bridge-item-title"/g) ?? []).length,
    }).toEqual({ alert: true, notice: true, open: false, titles: 2 });
  });

  it('says where a seen item was seen, and Seen alone where the gateway did not keep it', () => {
    const markup = render({ waiting: { count: 2, items: [anItem({ state: 'seen', seenIn: 'bridge' }), anItem({ deliveryId: 'dlv_02', state: 'seen' })] }, stayAware: [] });

    expect({ bridge: markup.includes('>Seen in Bridge<'), alone: markup.includes('>Seen<') }).toEqual({ bridge: true, alone: true });
  });

  it('keeps a seen alert or notice in the feed without its dot, counting only the unseen', () => {
    const markup = render({
      waiting: { count: 0, items: [] },
      stayAware: [anItem({ deliveryId: 'dlv_03', job: 'stay-aware', isAlert: true, from: 'watch' }), anItem({ deliveryId: 'dlv_04', job: 'stay-aware', from: 'builder-core', state: 'done', seenIn: 'bridge' })],
    });

    expect({ rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length, dots: (markup.match(/aria-label="New"/g) ?? []).length, unseen: markup.includes('1 unseen, outside the count') }).toEqual({ rows: 2, dots: 1, unseen: true });
  });
});

describe('the list beside an open item (decide.html, stay-aware.html, aeolus-fleet#1538)', () => {
  const HOME: BridgeHome = {
    waiting: { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', state: 'seen', actInPlace: { kind: 'openLink', href: 'https://github.com/new', host: 'github.com' } })] },
    stayAware: [anItem({ deliveryId: 'dlv_03', job: 'stay-aware', isAlert: true, from: 'watch', title: 'builder-gateway: no report change for 2 h' })],
  };

  function renderOpen(opened: ItemOpening['opened']): string {
    const opening: ItemOpening = { open: () => undefined, openingId: undefined, putPick: () => undefined, puttingId: undefined, failure: undefined, opened };
    return renderToStaticMarkup(createElement(HomeLists, { home: HOME, now: NOW, opening }));
  }

  it('shows what waits beside an open question, its count in the heading, the open one marked, and no buttons on the rows', () => {
    const markup = renderOpen({ deliveryId: 'dlv_01', job: 'decide' });

    expect({
      count: markup.includes('data-testid="bridge-count" class="text-tone-waiting-fg">2<'),
      sentence: markup.includes('Newest on top'),
      rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length,
      marked: /<li[^>]*aria-current="true"[^>]*>(?:(?!<\/li>).)*Which goes first/.test(markup),
      markedOnce: (markup.match(/aria-current="true"/g) ?? []).length,
      buttons: ['bridge-open', 'bridge-put-pick', 'bridge-step-link'].some((testId) => markup.includes(`data-testid="${testId}"`)),
      feed: markup.includes('builder-gateway: no report change for 2 h'),
    }).toEqual({ count: true, sentence: false, rows: 2, marked: true, markedOnce: 1, buttons: false, feed: false });
  });

  it('shows the stay-aware feed beside an open alert, with its unseen count, and not what waits', () => {
    const markup = renderOpen({ deliveryId: 'dlv_03', job: 'stay-aware' });

    expect({ feed: markup.includes('builder-gateway: no report change for 2 h'), unseen: markup.includes('>1 unseen<'), marked: (markup.match(/aria-current="true"/g) ?? []).length, waiting: markup.includes('Waiting on you') }).toEqual({ feed: true, unseen: true, marked: 1, waiting: false });
  });

  it('shows both lists in full while no item is open', () => {
    const markup = renderOpen(undefined);

    expect({ sentence: markup.includes('1 to decide, 1 to do. Newest on top; nothing else is in this count.'), feed: markup.includes('1 unseen, outside the count'), open: markup.includes('data-testid="bridge-open"') }).toEqual({ sentence: true, feed: true, open: true });
  });
});
