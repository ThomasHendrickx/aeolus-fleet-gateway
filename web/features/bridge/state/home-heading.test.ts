import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { HomeItem } from '../services/items';
import { HomeHeading } from './home-heading';
import { AsLastRead } from './kept-read';
import { SendMessageProvider } from './send-message';

function anItem(overrides: Partial<HomeItem> = {}): HomeItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first: the Compact look (U4) or Harbour?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', isAlert: false, state: 'new', stale: null, inBasket: null, seenIn: null, places: [], actInPlace: null, ...overrides };
}

const WAITING = { count: 2, items: [anItem(), anItem({ deliveryId: 'dlv_02', job: 'do', title: 'Create the GitHub repository aeolus-fleet-memory-plugin' })] };

function heading(waiting: typeof WAITING = WAITING): string {
  return renderToStaticMarkup(createElement(SendMessageProvider, { fleetId: 'flt_01', children: createElement(HomeHeading, { waiting }) }));
}

describe("Bridge home's title row, across what waits and Your fleet (#189, 4)", () => {
  it('shows what waits with its count, and what is in the count', () => {
    const markup = heading();

    expect({ count: markup.includes('data-testid="bridge-count" class="text-tone-waiting-fg">2<'), counts: markup.includes('1 to decide, 1 to do. Newest on top; nothing else is in this count.') }).toEqual({ count: true, counts: true });
  });

  it('leaves a withdrawn question out of what is in the count', () => {
    const markup = heading({ count: 1, items: [anItem({ deliveryId: 'dlv_02' }), anItem({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T20:09:00.000Z', replacementTitle: null } })] });

    expect(markup.includes('1 to decide, 0 to do.')).toBe(true);
  });

  it('titles the page at 20 px on a wider screen and 22 px on the phone, as the mockups draw it', () => {
    expect(/<h1[^>]*class="[^"]*text-title sm:text-heading-touch/.test(heading())).toBe(true);
  });

  it('says nothing waits when nothing does', () => {
    expect(heading({ count: 0, items: [] }).includes('Nothing waits on you.')).toBe(true);
  });

  it('offers to send a ship a message at its right end (aeolus-fleet #1547)', () => {
    expect(heading().includes('aria-label="Send a ship a message"')).toBe(true);
  });

  it('shows the phone the title and its count alone: the sentence and the button stay off the phone (#189, 9 and 10)', () => {
    const markup = heading();

    expect([/<p class="[^"]*max-sm:hidden[^"]*">1 to decide/.test(markup), /<span class="[^"]*max-sm:hidden[^"]*"><button[^>]*data-testid="bridge-send-message"/.test(markup)]).toEqual([true, true]);
  });
});

describe("Bridge home's title row as last read, while the record cannot be read (states.html)", () => {
  const markup = renderToStaticMarkup(createElement(AsLastRead, { at: '2026-10-31T20:14:00.000Z', children: createElement(HomeHeading, { waiting: WAITING }) }));

  it('says when it was last read under the title, in place of the count', () => {
    expect({
      title: /<h1[^>]*>Waiting on you<\/h1>/.test(markup),
      lastRead: markup.includes('data-testid="bridge-last-read">Last read 20:14 UTC<'),
      count: markup.includes('data-testid="bridge-count"'),
      send: markup.includes('data-testid="bridge-send-message"'),
    }).toEqual({ title: true, lastRead: true, count: false, send: false });
  });

  it("leaves the title row out on the phone, as the phone's frame draws it", () => {
    expect(/<div class="[^"]*max-sm:hidden[^"]*"><h1[^>]*>Waiting on you<\/h1>/.test(markup)).toBe(true);
  });
});
