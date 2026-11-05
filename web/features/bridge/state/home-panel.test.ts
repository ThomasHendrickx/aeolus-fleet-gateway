import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeHome, HomeItem } from '../services/items';
import type { ItemOpening } from './item-focus';
import { HomeLists, HomePanel } from './home-panel';
import { AsLastRead } from './kept-read';

function anItem(overrides: Partial<HomeItem> = {}): HomeItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first: the Compact look (U4) or Harbour?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', isAlert: false, state: 'new', stale: null, inBasket: null, seenIn: null, places: [], actInPlace: null, ...overrides };
}

/** When the page read Bridge home: the items' ages are from it. */
const NOW = '2026-10-31T20:00:00.000Z';

/** The router the page sits under; a static render never navigates. */
const ROUTER: AppRouterInstance = { back: () => undefined, forward: () => undefined, refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined, bfcacheId: 'home-panel-test' };

/** Bridge home with no plain message, unless one is given. */
type HomeRead = Omit<BridgeHome, 'messages'> & { messages?: BridgeHome['messages'] };

function render(home: HomeRead): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: ROUTER }, createElement(HomePanel, { fleetId: 'flt_01', home: { messages: [], ...home }, now: NOW })));
}

/** Home's lists as the page shows them, nothing open, the rows leaving named. */
function lists(home: HomeRead, leaving: ReadonlySet<string> = new Set()): string {
  const opening: ItemOpening = { open: () => undefined, openingId: undefined, putPick: () => undefined, puttingId: undefined, failure: undefined, opened: undefined };
  return renderToStaticMarkup(createElement(HomeLists, { fleetId: 'flt_01', home: { messages: [], ...home }, now: NOW, opening, leaving }));
}

describe('Bridge home (CC18)', () => {
  it('shows what waits, each item to decide or do with who asked', () => {
    const markup = render({
      waiting: { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', state: 'seen' })] },
      stayAware: [],
    });

    expect({
      rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length,
      seen: markup.includes('>Seen<'),
    }).toEqual({ rows: 2, seen: true });
  });

  it('marks a new item with a dot, and not one the person saw', () => {
    const markup = render({ waiting: { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', state: 'seen' })] }, stayAware: [] });

    expect((markup.match(/aria-label="New"/g) ?? []).length).toBe(1);
  });

  it('shows the alerts and notices not seen in the feed, outside the count', () => {
    const markup = render({ waiting: { count: 0, items: [] }, stayAware: [anItem({ deliveryId: 'dlv_03', job: 'stay-aware', from: 'watch', title: 'builder-gateway: no report change for 2 h' })] });

    expect({ feed: markup.includes('builder-gateway: no report change for 2 h'), outside: markup.includes('1 unseen, outside the count') }).toEqual({ feed: true, outside: true });
  });

  it('heads the stay-aware feed with its bell, as home.html draws it', () => {
    const markup = render({ waiting: { count: 0, items: [] }, stayAware: [] });

    expect(/<h2 id="bridge-stay-aware-heading"[^>]*><svg[^>]*lucide-bell/.test(markup)).toBe(true);
  });

  it('says nothing waits, and nothing new reached the person, when nothing does', () => {
    const markup = render({ waiting: { count: 0, items: [] }, stayAware: [] });

    expect({ nothingWaits: markup.includes('data-testid="bridge-nothing-waits"'), nothingNew: markup.includes('Nothing new. What you saw is in Done.') }).toEqual({ nothingWaits: true, nothingNew: true });
  });

  it('shows a withdrawn question stale, outside the count: struck through, with when it was withdrawn and its icon, not faded; it clears itself (#240)', () => {
    const markup = lists({ waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_02', title: 'Hold PR #1488?' }), anItem({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T20:09:00.000Z', replacementTitle: null } })] }, stayAware: [] });

    expect({
      stale: markup.includes('Withdrawn by orchestrator-1 at 20:09 UTC<'),
      clearByHand: markup.includes('open it to clear it'),
      struck: /<s[^>]*>Which goes first: the Compact look \(U4\) or Harbour\?<\/s>/.test(markup),
      icon: markup.includes('aria-label="Withdrawn"'),
      faded: markup.includes('opacity-60'),
      marked: (markup.match(/data-testid="bridge-item" data-stale="true"/g) ?? []).length,
    }).toEqual({ stale: true, clearByHand: false, struck: true, icon: true, faded: false, marked: 1 });
  });

  it('links a replaced question to its replacement, the new item', () => {
    const markup = lists({
      waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_03', title: 'Which goes first, now that U4 slipped?' }), anItem({ stale: { kind: 'replaced', replacementId: 'dlv_03', at: '2026-10-31T20:10:00.000Z', replacementTitle: 'Which goes first, now that U4 slipped?' } })] },
      stayAware: [],
    });

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 20:10 UTC with “Which goes first, now that U4 slipped?”'), icon: markup.includes('aria-label="Replaced"'), link: (markup.match(/data-testid="bridge-replacement"/g) ?? []).length }).toEqual({ stale: true, icon: true, link: 1 });
  });

  it('links a replaced step to its replacement, the new step', () => {
    const markup = lists({
      waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_03', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory' }), anItem({ job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin', stale: { kind: 'replaced', replacementId: 'dlv_03', at: '2026-10-31T20:11:00.000Z', replacementTitle: 'Create the GitHub repository aeolus-fleet-memory' } })] },
      stayAware: [],
    });

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 20:11 UTC with “Create the GitHub repository aeolus-fleet-memory”'), struck: /<s[^>]*>Create the GitHub repository aeolus-fleet-memory-plugin<\/s>/.test(markup), link: markup.includes('Open the new step') }).toEqual({ stale: true, struck: true, link: true });
  });

  it('never shows a question already withdrawn when Bridge home is first read: Bridge was not open at the withdrawal (#240)', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_02', title: 'Hold PR #1488?' }), anItem({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T20:09:00.000Z', replacementTitle: null } })] }, stayAware: [] });

    expect({ rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length, withdrawn: markup.includes('Which goes first') }).toEqual({ rows: 1, withdrawn: false });
  });

  it('draws a withdrawn row leaving in its last 300 ms, and the others not (#240)', () => {
    const markup = lists({ waiting: { count: 1, items: [anItem({ deliveryId: 'dlv_02', title: 'Hold PR #1488?' }), anItem({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T20:09:00.000Z', replacementTitle: null } })] }, stayAware: [] }, new Set(['dlv_01']));

    expect((markup.match(/data-leaving="true"/g) ?? []).length).toBe(1);
  });

  it('says on its row that a question is in the basket with the note alone', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ state: 'seen', inBasket: { option: null, note: 'Ask me after the demo.' } })] }, stayAware: [] });

    expect(markup.includes('In the basket: the note alone')).toBe(true);
  });

  it('says on its row that a question is in the basket with its option, still counted (section 9, rule 1)', () => {
    const markup = render({ waiting: { count: 1, items: [anItem({ state: 'seen', inBasket: { option: 2, note: null } })] }, stayAware: [] });

    expect({ inBasket: markup.includes('In the basket: option 2'), seen: markup.includes('Seen, not done yet') }).toEqual({ inBasket: true, seen: false });
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
    messages: [],
  };

  function renderOpen(opened: ItemOpening['opened']): string {
    const opening: ItemOpening = { open: () => undefined, openingId: undefined, putPick: () => undefined, puttingId: undefined, failure: undefined, opened };
    return renderToStaticMarkup(createElement(HomeLists, { fleetId: 'flt_01', home: HOME, now: NOW, opening }));
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

    expect({ feed: markup.includes('1 unseen, outside the count'), open: markup.includes('data-testid="bridge-open"') }).toEqual({ feed: true, open: true });
  });
});

describe('Bridge home as last read, while the record cannot be read (states.html)', () => {
  const home: BridgeHome = {
    waiting: { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin' })] },
    stayAware: [anItem({ deliveryId: 'dlv_03', job: 'stay-aware', from: 'watch', title: 'builder-gateway: no report change for 2 h' })],
    messages: [],
  };
  const markup = renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: ROUTER }, createElement(AsLastRead, { at: '2026-10-31T20:14:00.000Z', children: createElement(HomePanel, { fleetId: 'flt_01', home, now: NOW }) })),
  );

  it('shows what waited as last read, faded and not to be opened, saying so under it', () => {
    expect({
      rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length,
      faded: /<ul[^>]*inert=""[^>]*class="[^"]*opacity-60/.test(markup),
      open: markup.includes('data-testid="bridge-open"'),
      shown: markup.includes('Shown as last read, at 20:14 UTC.'),
    }).toEqual({ rows: 2, faded: true, open: false, shown: true });
  });

  it('leaves out the stay-aware feed', () => {
    expect(markup.includes('builder-gateway: no report change for 2 h')).toBe(false);
  });
});

describe('plain messages on Bridge home (#242)', () => {
  function aMessage(overrides: Partial<BridgeHome['messages'][number]> = {}): BridgeHome['messages'][number] {
    return { ...anItem({ deliveryId: 'dlv_11', job: 'everything-else', from: 'builder-core', title: '# Staging is green again after the migration', sentAt: '2026-10-31T19:57:00.000Z' }), excerpt: 'The 0.38 migration ran on staging at 19:52 and every **Testcontainers** suite passes.', ...overrides };
  }
  const many = (count: number) => Array.from({ length: count }, (_, index) => aMessage({ deliveryId: `dlv_${String(100 + index)}`, title: `Message ${String(index + 1)}`, state: index < 8 ? 'new' : 'seen' }));

  it('lists them beneath what waits, outside the count, each with its title and text as plain words, Done and Open', () => {
    const markup = render({ waiting: { count: 1, items: [anItem()] }, stayAware: [], messages: [aMessage(), aMessage({ deliveryId: 'dlv_12', title: 'Thanks: the basket sheet is merged', state: 'seen', seenIn: 'bridge', excerpt: '' })] });

    expect({
      heading: markup.includes('>Messages<'),
      said: markup.includes('1 new, outside the count'),
      title: markup.includes('>Staging is green again after the migration<'),
      text: markup.includes('The 0.38 migration ran on staging at 19:52 and every Testcontainers suite passes.'),
      done: (markup.match(/data-testid="bridge-message-done"/g) ?? []).length,
      open: (markup.match(/data-testid="bridge-message-open"/g) ?? []).length,
      after: markup.indexOf('bridge-waiting-heading') < markup.indexOf('bridge-messages-heading'),
    }).toEqual({ heading: true, said: true, title: true, text: true, done: 2, open: 2, after: true });
  });

  it('lists no Messages heading when no message is left', () => {
    expect(render({ waiting: { count: 1, items: [anItem()] }, stayAware: [] }).includes('bridge-messages-heading')).toBe(false);
  });

  it('lists only the 3 newest with many, then leads to all of them', () => {
    const markup = render({ waiting: { count: 0, items: [] }, stayAware: [], messages: many(20) });

    expect({ rows: (markup.match(/data-testid="bridge-message-done"/g) ?? []).length, all: /href="\/bridge\/messages\?fleet=flt_01"[^>]*>Show all 20 messages</.test(markup) }).toEqual({ rows: 3, all: true });
  });

  it('says on a phone how many new messages wait below, with many, leading to them', () => {
    const markup = render({ waiting: { count: 0, items: [] }, stayAware: [], messages: many(20) });

    expect(/data-testid="bridge-new-messages"[^>]*>.*8 new messages.*Show/.test(markup)).toBe(true);
  });

  it('says nothing on top with as few messages as home lists', () => {
    expect(render({ waiting: { count: 0, items: [] }, stayAware: [], messages: [aMessage()] }).includes('bridge-new-messages')).toBe(false);
  });
});
