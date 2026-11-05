import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeHome } from '../services/items';
import { MessagesPanel } from './messages-panel';

// The Messages page (#242, design/bridge-messages): every plain message,
// newest on top, Done and Open on each, and the seen ones marked done in one go.

const NOW = '2026-10-31T20:00:00.000Z';

/** The router the page sits under; a static render never navigates. */
const ROUTER: AppRouterInstance = { back: () => undefined, forward: () => undefined, refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined, bfcacheId: 'messages-panel-test' };

function aMessage(index: number, state: 'new' | 'seen'): BridgeHome['messages'][number] {
  return { deliveryId: `dlv_${String(100 + index)}`, from: 'builder-core', title: `Message ${String(index)}`, sentAt: '2026-10-31T19:57:00.000Z', job: 'everything-else', isAlert: false, state, stale: null, inBasket: null, seenIn: state === 'seen' ? 'bridge' : null, places: [], actInPlace: null, excerpt: '' };
}

function pageOf(messages: BridgeHome['messages']): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: ROUTER }, createElement(MessagesPanel, { fleetId: 'flt_01', messages, now: NOW })));
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
    expect(/data-testid="bridge-mark-seen-done"[^>]*>Mark the 12 seen done</.test(pageOf(TWENTY))).toBe(true);
  });

  it('offers no marking in one go while none is seen', () => {
    expect(pageOf([aMessage(1, 'new')]).includes('bridge-mark-seen-done')).toBe(false);
  });

  it('says no message is left once all are done', () => {
    expect(pageOf([]).includes('No message waits. What you marked done is in Done.')).toBe(true);
  });
});
