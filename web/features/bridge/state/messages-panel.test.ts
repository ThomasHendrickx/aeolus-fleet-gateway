import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeHome } from '../services/items';
import { HomeHeading } from './home-heading';
import { MessagesPanel } from './messages-panel';
import { SendMessageProvider } from './send-message';

// The Messages page (#242): every plain message,
// newest on top, Done and Open on each, and the seen ones marked done in one go.

const NOW = '2026-10-31T20:00:00.000Z';

/** The router the page sits under; a static render never navigates. */
const ROUTER: AppRouterInstance = { back: () => undefined, forward: () => undefined, refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined, bfcacheId: 'messages-panel-test' };

function aMessage(index: number, state: 'new' | 'seen'): BridgeHome['messages'][number] {
  return { deliveryId: `dlv_${String(100 + index)}`, from: 'builder-core', fromShipId: 'shp_01', title: `Message ${String(index)}`, sentAt: '2026-10-31T19:57:00.000Z', job: 'everything-else', isAlert: false, state, stale: null, inBasket: null, seenIn: state === 'seen' ? 'bridge' : null, places: [], actInPlace: null, excerpt: '' };
}

function pageOf(messages: BridgeHome['messages']): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: ROUTER }, createElement(MessagesPanel, { fleetId: 'flt_01', messages, now: NOW })));
}

/** The page under Bridge's shell, which offers every page the form to send a ship a message. */
function pageInShellOf(messages: BridgeHome['messages']): string {
  return renderToStaticMarkup(createElement(SendMessageProvider, { fleetId: 'flt_01', children: createElement(AppRouterContext.Provider, { value: ROUTER }, createElement(MessagesPanel, { fleetId: 'flt_01', messages, now: NOW })) }));
}

/** Where a page shows Send a ship a message: the button and the part that holds it. */
function sendMessageOf(markup: string): string | undefined {
  return /<span[^>]*><button[^>]*data-testid="bridge-send-message".*?<\/button><\/span>/.exec(markup)?.[0];
}

const TWENTY = Array.from({ length: 20 }, (_, index) => aMessage(index + 1, index < 8 ? 'new' : 'seen'));

describe('the Messages page (#242)', () => {
  it('lists every message with its count, how many are new and seen, Done and Open on each', () => {
    const markup = pageOf(TWENTY);

    expect({
      count: /id="bridge-messages-heading"[^>]*>Messages <span[^>]*>20</.test(markup),
      said: markup.includes('8 new, 12 seen. Outside the count; each stays until you mark it done.'),
      rows: (markup.match(/data-testid="bridge-message-done"/g) ?? []).length,
    }).toEqual({ count: true, said: true, rows: 20 });
  });

  it('offers to mark the seen ones done in one go', () => {
    expect(/data-testid="bridge-mark-seen-done"[^>]*>.*Mark the 12 seen done</.test(pageOf(TWENTY))).toBe(true);
  });

  it('offers no marking in one go while none is seen', () => {
    expect(pageOf([aMessage(1, 'new')]).includes('bridge-mark-seen-done')).toBe(false);
  });

  it('says no message is left once all are done', () => {
    expect(pageOf([]).includes('No message waits. What you marked done is in Done.')).toBe(true);
  });
});

describe('the Messages page, as drawn (#242 review)', () => {
  it('puts Mark the 12 seen done in its heading row, with its double check', () => {
    expect(/data-testid="bridge-messages-head".*<button[^>]*data-testid="bridge-mark-seen-done"[^>]*><svg[^>]*lucide-check-check/.test(pageOf(TWENTY))).toBe(true);
  });

  it('keeps its list to a column, not the window', () => {
    expect(/<section class="[^"]*max-w-\[44rem\]/.test(pageOf(TWENTY))).toBe(true);
  });

  it('keeps the sentence under its heading to a desktop', () => {
    expect(/<p class="[^"]*max-sm:hidden[^"]*">8 new, 12 seen/.test(pageOf(TWENTY))).toBe(true);
  });
});

describe('the Messages page, sending a ship a message as home does (#284)', () => {
  it('offers Send a ship a message in its heading row', () => {
    expect(/data-testid="bridge-messages-head".*<button[^>]*aria-label="Send a ship a message"/.test(pageInShellOf(TWENTY))).toBe(true);
  });

  it('offers it while no message waits too', () => {
    expect(pageInShellOf([]).includes('data-testid="bridge-send-message"')).toBe(true);
  });

  it("shows the same button as home's Waiting on you, kept off the phone as home keeps it", () => {
    const home = renderToStaticMarkup(createElement(SendMessageProvider, { fleetId: 'flt_01', children: createElement(HomeHeading, { waiting: { count: 0, items: [] } }) }));

    expect({ messages: sendMessageOf(pageInShellOf(TWENTY)), isOffThePhone: sendMessageOf(home)?.startsWith('<span class="max-sm:hidden">') }).toEqual({ messages: sendMessageOf(home), isOffThePhone: true });
  });
});
