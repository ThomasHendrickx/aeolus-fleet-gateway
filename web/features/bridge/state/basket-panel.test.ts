import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BasketItem, BasketView } from '../services/basket';
import { BasketPanel } from './basket-panel';

// The basket open (Bridge, section 9; basket.html, basket-3 to basket-7):
// the heading counts what is or will be sent; each entry with its question,
// asker and time, its answer by number and label, Change and Remove at the
// top right, struck out when not sent; the foot naming the ships, Sending N
// of M, or what came of the send; what was sent over the empty basket.

function anEntry(overrides: Partial<BasketItem> = {}): BasketItem {
  return {
    questionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
    deliveryId: 'dlv_01',
    from: 'orchestrator-1',
    title: 'Which goes first: the Compact look (U4) or Harbour?',
    sentAt: '2026-10-31T19:41:00.000Z',
    option: 2,
    optionLabel: "Harbour first, on today's look",
    note: 'Harbour first: the demo on 12 Nov needs it.',
    standing: { kind: 'waiting' },
    ...overrides,
  };
}

function render(basket: BasketView): string {
  return renderToStaticMarkup(createElement(BasketPanel, { fleetId: 'flt_01', basket }));
}

function countOf(markup: string, testId: string): number {
  return (markup.match(new RegExp(`data-testid="${testId}"`, 'g')) ?? []).length;
}

describe('the basket open', () => {
  it('heads the basket with the count of what is or will be sent', () => {
    expect(render({ count: 2, toSend: 2, entries: [anEntry(), anEntry({ questionId: 'q2' })] })).toContain('<span data-testid="bridge-basket-count" class="text-primary">2</span>');
  });

  it('lists each entry with its question, asker, time asked, answer by number and label, and quoted note, Change and Remove at its top right (basket-3)', () => {
    const markup = render({ count: 2, toSend: 2, entries: [anEntry(), anEntry({ questionId: 'q2', deliveryId: 'dlv_02', from: 'commercial', title: 'Pricing page: a price per ship, or plans only?', option: 1, optionLabel: 'Plans only', note: null })] });

    expect({
      rows: countOf(markup, 'bridge-basket-entry'),
      asker: markup.includes('>commercial</b>'),
      askedAt: markup.includes('asked at 19:41 UTC'),
      answer: markup.includes('2. Harbour first, on today&#x27;s look'),
      note: markup.includes('&quot;Harbour first: the demo on 12 Nov needs it.&quot;'),
      change: countOf(markup, 'bridge-basket-change'),
      remove: countOf(markup, 'bridge-basket-remove'),
      send: markup.includes('Send 2 answers'),
      names: markup.includes('orchestrator-1 and commercial each receive their own answer, as you, as if sent one by one.'),
    }).toEqual({ rows: 2, asker: true, askedAt: true, answer: true, note: true, change: 2, remove: 2, send: true, names: true });
  });

  it('strikes out a withdrawn and a replaced entry, with Remove under it and Answer the new question for the replaced one, and no Change (basket-4)', () => {
    const markup = render({
      count: 1,
      toSend: 1,
      entries: [
        anEntry({ questionId: 'q1', standing: { kind: 'withdrawn', at: '2026-10-31T20:09:00.000Z' } }),
        anEntry({ questionId: 'q2', standing: { kind: 'replaced', replacementId: 'dlv_09', at: '2026-10-31T20:11:00.000Z', replacementTitle: 'Pricing page: plans only?' } }),
        anEntry({ questionId: 'q3' }),
      ],
    });

    expect({
      struck: (markup.match(/line-through/g) ?? []).length,
      withdrawn: markup.includes('Withdrawn by orchestrator-1 at 20:09 UTC. Not sent; Send skips it.'),
      replacement: countOf(markup, 'bridge-replacement'),
      change: countOf(markup, 'bridge-basket-change'),
      remove: countOf(markup, 'bridge-basket-remove'),
      foot: markup.includes('1 to send. The withdrawn and the replaced one are not sent.'),
    }).toEqual({ struck: 4, withdrawn: true, replacement: 1, change: 1, remove: 3, foot: true });
  });

  it('says each entry as the send goes, with neither Change nor Remove, and Sending N of M in place of Send (basket-5)', () => {
    const markup = render({
      count: 3,
      toSend: 0,
      entries: [anEntry({ questionId: 'q1', standing: { kind: 'sent', at: '2026-10-31T20:16:00.000Z' } }), anEntry({ questionId: 'q2', standing: { kind: 'sending', isUnanswered: false } }), anEntry({ questionId: 'q3', standing: { kind: 'sending', isUnanswered: false } })],
    });

    expect({
      sent: markup.includes('Sent at 20:16 UTC and stored. Done.'),
      next: markup.includes('Next, in the order you added it'),
      change: countOf(markup, 'bridge-basket-change'),
      remove: countOf(markup, 'bridge-basket-remove'),
      send: countOf(markup, 'bridge-basket-send'),
      progress: /data-testid="bridge-basket-sending"[^>]*disabled=""[^>]*>.*Sending 2 of 3/.test(markup),
      close: markup.includes('You can close Bridge: the gateway keeps sending what is stored as sending.'),
    }).toEqual({ sent: true, next: true, change: 0, remove: 0, send: 0, progress: true, close: true });
  });

  it('sums up what was sent over the empty basket once every entry was sent (basket-6)', () => {
    const markup = render({ count: 0, toSend: 0, entries: [anEntry({ standing: { kind: 'sent', at: '2026-10-31T20:16:00.000Z' } })] });

    expect({
      summary: markup.includes('1 answer sent'),
      entries: countOf(markup, 'bridge-basket-entry'),
      empty: markup.includes('Pick an option on a question and put it in the basket; it waits here until you send it.'),
    }).toEqual({ summary: true, entries: 0, empty: true });
  });

  it('keeps the sent entry, says the refusal in words with Remove and mark done, and sums up the send (basket-7)', () => {
    const markup = render({
      count: 2,
      toSend: 0,
      entries: [
        anEntry({ questionId: 'q1', standing: { kind: 'sent', at: '2026-10-31T20:16:00.000Z' } }),
        anEntry({ questionId: 'q2', standing: { kind: 'sending', isUnanswered: true } }),
        anEntry({ questionId: 'q3', from: 'commercial', standing: { kind: 'refused', reason: 'commercial was retired, so it cannot receive an answer' } }),
      ],
    });

    expect({
      refused: markup.includes('Not sent: commercial was retired, so it cannot receive an answer. The others were sent.'),
      removeAndDone: markup.includes('Remove and mark done'),
      summary: markup.includes('1 sent, 1 still sending, 1 not sent.'),
      progress: countOf(markup, 'bridge-basket-sending'),
    }).toEqual({ refused: true, removeAndDone: true, summary: true, progress: 0 });
  });

  it('says the basket is empty, with nothing to send', () => {
    const markup = render({ count: 0, toSend: 0, entries: [] });

    expect({ empty: countOf(markup, 'bridge-basket-empty'), words: markup.includes('The basket is empty'), send: countOf(markup, 'bridge-basket-send') }).toEqual({ empty: 1, words: true, send: 0 });
  });
});
