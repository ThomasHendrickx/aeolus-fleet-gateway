import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BasketItem, BasketView } from '../services/basket';
import { BasketPanel } from './basket-panel';

// The basket open (Bridge, section 9, rule 2; the basket mockup): each entry
// with its question, asker, option and note; Change and Remove; Send N
// answers naming how many it sends.

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

describe('the basket open', () => {
  it('lists each entry with its question, asker, option and note, Change and Remove, and Send naming how many answers it sends', () => {
    const markup = render({ count: 0, toSend: 2, entries: [anEntry(), anEntry({ questionId: 'q2', deliveryId: 'dlv_02', from: 'commercial', title: 'Pricing page: a price per ship, or plans only?', option: 1, note: null })] });

    expect({
      rows: (markup.match(/data-testid="bridge-basket-entry"/g) ?? []).length,
      asker: markup.includes('to commercial'),
      option: markup.includes('Option 2'),
      note: markup.includes('“Harbour first: the demo on 12 Nov needs it.”'),
      change: (markup.match(/data-testid="bridge-basket-change"/g) ?? []).length,
      remove: (markup.match(/data-testid="bridge-basket-remove"/g) ?? []).length,
      send: markup.includes('>Send 2 answers<'),
    }).toEqual({ rows: 2, asker: true, option: true, note: true, change: 2, remove: 2, send: true });
  });

  it('lists an entry with only a note as the note alone, with no option', () => {
    const markup = render({ count: 0, toSend: 1, entries: [anEntry({ option: null, note: 'Neither: ask me after the demo.' })] });

    expect({ noteAlone: markup.includes('Note alone'), option: markup.includes('Option'), note: markup.includes('“Neither: ask me after the demo.”') }).toEqual({ noteAlone: true, option: false, note: true });
  });

  it('says a withdrawn, a replaced, a refused and a sending entry as they stand, with no Change, and counts only what Send sends', () => {
    const markup = render({
      count: 0,
      toSend: 1,
      entries: [
        anEntry({ questionId: 'q1', standing: { kind: 'withdrawn', at: '2026-10-31T20:09:00.000Z' } }),
        anEntry({ questionId: 'q2', standing: { kind: 'replaced', replacementId: 'dlv_09', at: '2026-10-31T20:11:00.000Z', replacementTitle: 'Pricing page: plans only?' } }),
        anEntry({ questionId: 'q3', standing: { kind: 'refused', reason: 'orchestrator-1 did not take the answer: retired' } }),
        anEntry({ questionId: 'q4', standing: { kind: 'sending', isUnanswered: false } }),
        anEntry({ questionId: 'q5' }),
      ],
    });

    expect({
      withdrawn: markup.includes('Withdrawn by orchestrator-1. Not sent; Send skips it.'),
      replacement: markup.includes('data-testid="bridge-replacement"'),
      refused: markup.includes('Remove and mark done'),
      sending: markup.includes('Sending...'),
      change: (markup.match(/data-testid="bridge-basket-change"/g) ?? []).length,
      send: markup.includes('>Send 1 answer<'),
    }).toEqual({ withdrawn: true, replacement: true, refused: true, sending: true, change: 1, send: true });
  });

  it('says the basket is empty, with nothing to send', () => {
    const markup = render({ count: 0, toSend: 0, entries: [] });

    expect({ empty: markup.includes('The basket is empty'), send: markup.includes('data-testid="bridge-basket-send"') }).toEqual({ empty: true, send: false });
  });
});
