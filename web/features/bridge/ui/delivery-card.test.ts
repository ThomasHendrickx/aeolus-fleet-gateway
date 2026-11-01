import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FocusedDelivery } from '../services/deliveries';
import { DeliveryCard } from './delivery-card';

// A question opened in Bridge (CC11): the asker's pick preselected, one
// button naming what it sends; one its asker withdrew or replaced is stale,
// with nothing to send, a replaced one linked to its replacement.

const QUESTION = {
  id: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
  title: 'Which goes first: the Compact look (U4) or Harbour?',
  context: 'Both are approved and touch the same parts.',
  options: [
    { key: 1, label: 'Compact first (U4), then Harbour', detail: 'Harbour is built once.' },
    { key: 2, label: 'Harbour first, on today’s look', detail: 'Harbour shows a week sooner.' },
  ],
  pick: { option: 2, why: 'The demo on 12 Nov needs it.' },
};

function aQuestion(overrides: Partial<FocusedDelivery> = {}): FocusedDelivery {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: QUESTION.title, sentAt: '2026-10-31T19:41:00.000Z', payload: JSON.stringify(QUESTION), body: JSON.stringify(QUESTION), question: QUESTION, meetingId: undefined, stale: null, ...overrides };
}

function render(delivery: FocusedDelivery): string {
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(DeliveryCard, { delivery, isDoneOnSeeing: false, meetingHref: undefined, note: '', working: undefined, failure: undefined, onNoteChange: noop, onAnswer: noop, onDone: noop, onOpen: noop, onBack: noop }),
  );
}

describe('a question opened in Bridge (CC11)', () => {
  it("opens with the asker's pick preselected, and one button naming the option it sends", () => {
    const markup = render(aQuestion());

    expect({
      choices: (markup.match(/type="radio"/g) ?? []).length,
      picked: /value="2"[^>]*checked=""/.test(markup),
      theirPick: markup.includes('Their pick'),
      send: markup.includes('>Send option 2<'),
    }).toEqual({ choices: 2, picked: true, theirPick: true, send: true });
  });

  it('shows a withdrawn question stale: nothing to choose or send', () => {
    const markup = render(aQuestion({ stale: { kind: 'withdrawn', replacementId: null } }));

    expect({ stale: markup.includes('Withdrawn by orchestrator-1. Nothing to answer: it is done.'), send: markup.includes('Send option'), note: markup.includes('data-testid="bridge-note"') }).toEqual({ stale: true, send: false, note: false });
  });

  it('links a replaced question to its replacement', () => {
    const markup = render(aQuestion({ stale: { kind: 'replaced', replacementId: 'dlv_02' } }));

    expect({ stale: markup.includes('Replaced by orchestrator-1. Answer the new question.'), link: markup.includes('data-testid="bridge-replacement"'), send: markup.includes('Send option') }).toEqual({ stale: true, link: true, send: false });
  });
});
