import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FocusedDelivery } from '../services/deliveries';
import { DeliveryCard } from './delivery-card';

// A question opened in Bridge (CC11): the asker's pick preselected, one
// button putting it in the basket (CC24), naming the option; one its asker
// withdrew or replaced is stale, with nothing to send, a replaced one linked
// to its replacement. One in the basket says so (section 9, rule 1).

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
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: QUESTION.title, sentAt: '2026-10-31T19:41:00.000Z', payload: JSON.stringify(QUESTION), body: JSON.stringify(QUESTION), question: QUESTION, step: undefined, meetingId: undefined, stale: null, ...overrides };
}

function render(delivery: FocusedDelivery, shown: { inBasket?: { option: number; note: string | null } | null; note?: string } = {}): string {
  const { inBasket = null, note = '' } = shown;
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(DeliveryCard, {
      delivery,
      isDoneOnSeeing: false,
      meetingHref: undefined,
      basketHref: '/bridge/basket?fleet=flt_01',
      inBasket,
      note,
      working: undefined,
      failure: undefined,
      onNoteChange: noop,
      onAnswer: noop,
      onPut: noop,
      onRemove: noop,
      onDone: noop,
      onFinishStep: noop,
      onOpen: noop,
      onBack: noop,
    }),
  );
}

describe('a question opened in Bridge (CC11)', () => {
  it("opens with the asker's pick preselected, and one button putting that option in the basket, sending nothing (CC24)", () => {
    const markup = render(aQuestion());

    expect({
      choices: (markup.match(/type="radio"/g) ?? []).length,
      picked: markup.includes('checked="" value="2"') && !markup.includes('checked="" value="1"'),
      theirPick: markup.includes('Their pick'),
      put: markup.includes('>Put option 2 in the basket<'),
      said: markup.includes('Nothing is sent yet. orchestrator-1 receives this answer when you send the basket.'),
      sendsAtOnce: markup.includes('Send option') || markup.includes('Send the note alone'),
    }).toEqual({ choices: 2, picked: true, theirPick: true, put: true, said: true, sendsAtOnce: false });
  });

  it('says a question whose answer is in the basket is in it, not sent, with its note, its option picked, the basket and Remove beside it', () => {
    const markup = render(aQuestion(), { inBasket: { option: 1, note: 'U4 first, then Harbour.' } });

    expect({
      inBasket: markup.includes('In the basket: option 1, not sent'),
      note: markup.includes('“U4 first, then Harbour.”'),
      picked: markup.includes('checked="" value="1"'),
      basket: markup.includes('href="/bridge/basket?fleet=flt_01"'),
      remove: markup.includes('data-testid="bridge-basket-remove"'),
    }).toEqual({ inBasket: true, note: true, picked: true, basket: true, remove: true });
  });

  it('offers to put the note alone in the basket once the note has text, beside the option', () => {
    const markup = render(aQuestion(), { note: 'Neither: ask me after the demo.' });

    expect({ noteAlone: markup.includes('>Put the note alone in the basket<'), option: markup.includes('>Put option 2 in the basket<') }).toEqual({ noteAlone: true, option: true });
  });

  it('offers no note alone while the note is empty', () => {
    const markup = render(aQuestion());

    expect(markup.includes('data-testid="bridge-put-note-alone"')).toBe(false);
  });

  it('says a question whose note alone is in the basket is in it, not sent, with its note', () => {
    const markup = render(aQuestion(), { inBasket: { option: null, note: 'Neither: ask me after the demo.' } });

    expect({ inBasket: markup.includes('In the basket: the note alone, not sent'), note: markup.includes('“Neither: ask me after the demo.”') }).toEqual({ inBasket: true, note: true });
  });

  it('shows a withdrawn question stale: nothing to choose or send', () => {
    const markup = render(aQuestion({ stale: { kind: 'withdrawn', replacementId: null } }));

    expect({ stale: markup.includes('Withdrawn by orchestrator-1. Nothing to answer: it is done.'), send: markup.includes('in the basket'), note: markup.includes('data-testid="bridge-note"') }).toEqual({ stale: true, send: false, note: false });
  });

  it('links a replaced question to its replacement', () => {
    const markup = render(aQuestion({ stale: { kind: 'replaced', replacementId: 'dlv_02' } }));

    expect({ stale: markup.includes('Replaced by orchestrator-1. Answer the new question.'), link: markup.includes('data-testid="bridge-replacement"'), send: markup.includes('in the basket') }).toEqual({ stale: true, link: true, send: false });
  });
});

describe('a step opened in Bridge (CC14)', () => {
  const STEP = { title: 'Sign in to attio', why: "Until you sign in, your ships' calls to attio are refused.", link: { href: 'https://gateway.example.com/outside-parties/attio?fleet=flt_01', host: 'gateway.example.com' } };

  function aStep(): FocusedDelivery {
    return { deliveryId: 'dlv_03', from: 'gateway', title: STEP.title, sentAt: '2026-10-31T21:00:00.000Z', payload: '{}', body: '{}', question: undefined, step: STEP, meetingId: undefined, stale: null };
  }

  it('shows why, and the link with the host it leads to, opened only by the person', () => {
    const markup = render(aStep());

    expect({
      why: markup.includes("Until you sign in, your ships&#x27;"),
      link: markup.includes('href="https://gateway.example.com/outside-parties/attio?fleet=flt_01"'),
      host: markup.includes('Open on gateway.example.com'),
    }).toEqual({ why: true, link: true, host: true });
  });

  it('shows its note field before Done or Cannot, for either, with no answer to send', () => {
    const markup = render(aStep(), { note: 'It asked for read access only' });

    expect({
      noteFirst: markup.indexOf('data-testid="bridge-note"') < markup.indexOf('data-testid="bridge-step-done"'),
      note: markup.includes('It asked for read access only'),
      noteSays: markup.includes('Optional, goes with Done or Cannot'),
      done: markup.includes('data-testid="bridge-step-done"'),
      cannot: markup.includes('data-testid="bridge-step-cannot"'),
      answer: markup.includes('data-testid="bridge-answer"'),
    }).toEqual({ noteFirst: true, note: true, noteSays: true, done: true, cannot: true, answer: false });
  });
});
