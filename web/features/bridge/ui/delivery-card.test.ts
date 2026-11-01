import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FocusedDelivery } from '../services/deliveries';
import { DeliveryCard, type StepFinished } from './delivery-card';

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

function render(delivery: FocusedDelivery, shown: { inBasket?: { option: number | null; note: string | null } | null; note?: string; finished?: StepFinished | null } = {}): string {
  const { inBasket = null, note = '', finished = null } = shown;
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(DeliveryCard, {
      delivery,
      isDoneOnSeeing: false,
      meetingHref: undefined,
      basketHref: '/bridge/basket?fleet=flt_01',
      inBasket,
      finished,
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
    }).toEqual({ choices: 3, picked: true, theirPick: true, put: true, said: true, sendsAtOnce: false });
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

  it('offers No option, only the note, among the options, for an answer with the note alone', () => {
    const markup = render(aQuestion());

    expect({ choices: (markup.match(/type="radio"/g) ?? []).length, noteAlone: markup.includes('No option, only the note'), secondButton: markup.includes('data-testid="bridge-put-note-alone"') }).toEqual({ choices: 3, noteAlone: true, secondButton: false });
  });

  it('opens a question whose note alone is in the basket with No option, only the note chosen, its button putting the note alone', () => {
    const markup = render(aQuestion(), { inBasket: { option: null, note: 'Neither: ask me after the demo.' }, note: 'Neither: ask me after the demo.' });

    expect({ chosen: markup.includes('checked="" value=""'), put: markup.includes('>Put the note alone in the basket<') }).toEqual({ chosen: true, put: true });
  });

  it('puts no note alone while the note is empty', () => {
    const markup = render(aQuestion(), { inBasket: { option: null, note: 'Neither: ask me after the demo.' }, note: '' });

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Put the note alone in the basket</);
  });

  it('says a question whose note alone is in the basket is in it, not sent, with its note', () => {
    const markup = render(aQuestion(), { inBasket: { option: null, note: 'Neither: ask me after the demo.' } });

    expect({ inBasket: markup.includes('In the basket: the note alone, not sent'), note: markup.includes('“Neither: ask me after the demo.”') }).toEqual({ inBasket: true, note: true });
  });

  it('shows a withdrawn question stale: nothing to choose or send', () => {
    const markup = render(aQuestion({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T20:09:00.000Z', replacementTitle: null } }));

    expect({ stale: markup.includes('Withdrawn by orchestrator-1 at 20:09 UTC. Nothing to answer: it is done.'), send: markup.includes('in the basket'), note: markup.includes('data-testid="bridge-note"') }).toEqual({ stale: true, send: false, note: false });
  });

  it('links a replaced question to its replacement', () => {
    const markup = render(aQuestion({ stale: { kind: 'replaced', replacementId: 'dlv_02', at: '2026-10-31T20:10:00.000Z', replacementTitle: 'Which goes first, now that U4 slipped?' } }));

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 20:10 UTC with “Which goes first, now that U4 slipped?”. Answer the new question.'), link: markup.includes('data-testid="bridge-replacement"'), send: markup.includes('in the basket') }).toEqual({ stale: true, link: true, send: false });
  });
});

describe('a step opened in Bridge (CC14)', () => {
  const STEP = { title: 'Create the GitHub repository aeolus-fleet-memory-plugin', why: 'No ship can create a repository under your account.', link: { href: 'https://github.com/new', address: 'github.com/new', isOutside: true } };

  function aStep(overrides: Partial<FocusedDelivery> = {}): FocusedDelivery {
    return { deliveryId: 'dlv_03', from: 'orchestrator-1', title: STEP.title, sentAt: '2026-10-31T20:00:00.000Z', payload: '{}', body: '{}', question: undefined, step: STEP, meetingId: undefined, stale: null, ...overrides };
  }

  it('shows why, and the link in its box: where it is done, its host and path, that it opens outside Aeolus, and Open, opened only by the person', () => {
    const markup = render(aStep());

    expect({
      why: markup.includes('No ship can create a repository under your account.'),
      label: markup.includes('Where it is done'),
      address: markup.includes('github.com/new · opens outside Aeolus'),
      open: /<a[^>]*data-testid="bridge-step-link"[^>]*href="https:\/\/github.com\/new"[^>]*>Open<\/a>/.test(markup) || /<a[^>]*href="https:\/\/github.com\/new"[^>]*data-testid="bridge-step-link"[^>]*>Open<\/a>/.test(markup),
      newTab: markup.includes('target="_blank"'),
    }).toEqual({ why: true, label: true, address: true, open: true, newTab: true });
  });

  it("says nothing of outside Aeolus for a link to Bridge's own host, as the gateway's own steps have", () => {
    const markup = render(aStep({ step: { ...STEP, link: { href: 'https://gateway.example.com/outside-parties/attio', address: 'gateway.example.com/outside-parties/attio', isOutside: false } } }));

    expect({ address: markup.includes('gateway.example.com/outside-parties/attio'), outside: markup.includes('opens outside Aeolus') }).toEqual({ address: true, outside: false });
  });

  it('shows its note field before Done or Cannot, in the words do.html gives it, for either, with no answer to send', () => {
    const markup = render(aStep(), { note: 'Created private and empty.' });

    expect({
      noteFirst: markup.indexOf('data-testid="bridge-note"') < markup.indexOf('data-testid="bridge-step-done"'),
      note: markup.includes('Created private and empty.'),
      label: markup.includes('Note (optional)'),
      placeholder: markup.includes('placeholder="Add a note for orchestrator-1: what you did, or why you cannot"'),
      help: markup.includes('Sent with Done or Cannot, whichever you press.'),
      done: markup.includes('data-testid="bridge-step-done"'),
      cannot: markup.includes('data-testid="bridge-step-cannot"'),
      answer: markup.includes('data-testid="bridge-answer"'),
    }).toEqual({ noteFirst: true, note: true, label: true, placeholder: true, help: true, done: true, cannot: true, answer: false });
  });

  it('marks Done with its check, and says under the two what each tells the asker', () => {
    const markup = render(aStep());

    expect({
      check: /data-testid="bridge-step-done"[^>]*>(?:(?!<\/button>).)*lucide-check/.test(markup),
      info: markup.includes('Done tells orchestrator-1 you did it, Cannot that you could not; the note goes with either. Whether it worked is theirs to check.'),
    }).toEqual({ check: true, info: true });
  });

  it('shows a step done in Bridge on the step: when, the note quoted, and what was sent; its Open, note and buttons gone', () => {
    const markup = render(aStep(), { finished: { outcome: 'done', note: 'Created private and empty.', at: '2026-10-31T20:03:00.000Z' } });

    expect({
      title: markup.includes('Done in Bridge at 20:03 UTC'),
      note: markup.includes('“Created private and empty.”'),
      sent: markup.includes('Sent to orchestrator-1 as you, with the outcome done.'),
      tone: /data-testid="bridge-step-outcome"[^>]*tone-ok/.test(markup),
      address: markup.includes('github.com/new · opens outside Aeolus'),
      open: markup.includes('data-testid="bridge-step-link"'),
      noteField: markup.includes('data-testid="bridge-note"'),
      done: markup.includes('data-testid="bridge-step-done"'),
    }).toEqual({ title: true, note: true, sent: true, tone: true, address: true, open: false, noteField: false, done: false });
  });

  it('shows a step the person cannot do in the ended tone, with its X, when, the note quoted and what was sent', () => {
    const markup = render(aStep(), { finished: { outcome: 'cannot', note: 'The name is taken.', at: '2026-10-31T20:05:00.000Z' } });

    expect({
      title: markup.includes('Cannot, in Bridge at 20:05 UTC'),
      note: markup.includes('“The name is taken.”'),
      sent: markup.includes('Sent to orchestrator-1 as you, with the outcome cannot.'),
      ended: /data-testid="bridge-step-outcome"[^>]*border-tone-ended-border bg-tone-ended-bg/.test(markup) && /lucide-circle-x[^"]*text-tone-ended-fg/.test(markup),
      icon: markup.includes('lucide-circle-x'),
      cannot: markup.includes('data-testid="bridge-step-cannot"'),
    }).toEqual({ title: true, note: true, sent: true, ended: true, icon: true, cannot: false });
  });

  it.each([
    { outcome: 'done' as const, icon: 'lucide-circle-check', tone: 'text-tone-ok-fg' },
    { outcome: 'cannot' as const, icon: 'lucide-circle-x', tone: 'text-tone-ended-fg' },
  ])('words the $outcome box in the foreground, its sent line muted, only its icon in its tone', ({ outcome, icon, tone }) => {
    const markup = render(aStep(), { finished: { outcome, note: 'A note.', at: '2026-10-31T20:03:00.000Z' } });
    const box = /<div data-testid="bridge-step-outcome"[^>]*>/.exec(markup)?.[0] ?? '';

    expect({
      boxInTone: box.includes('text-tone-'),
      iconInTone: new RegExp(`${icon}[^"]*${tone}`).test(markup),
      sentMuted: /<span class="[^"]*text-muted-foreground[^"]*">“A note\.” Sent to orchestrator-1/.test(markup),
    }).toEqual({ boxInTone: false, iconInTone: true, sentMuted: true });
  });

  it('grows the note field with its note, so a note of three lines shows whole', () => {
    const markup = render(aStep(), { note: 'A note of three lines.' });

    expect(/<textarea[^>]*data-testid="bridge-note"[^>]*class="[^"]*field-sizing-content/.test(markup)).toBe(true);
  });

  it('shows an outcome sent with no note without a quote', () => {
    const markup = render(aStep(), { finished: { outcome: 'done', note: '', at: '2026-10-31T20:03:00.000Z' } });

    expect({ quote: markup.includes('“'), sent: markup.includes('Sent to orchestrator-1 as you, with the outcome done.') }).toEqual({ quote: false, sent: true });
  });

  it('shows a withdrawn step stale, struck through with when it was withdrawn: nothing to do, no link, Done or Cannot', () => {
    const markup = render(aStep({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T21:09:00.000Z', replacementTitle: null } }));

    expect({
      stale: markup.includes('Withdrawn by orchestrator-1 at 21:09 UTC. Nothing to do: it is done.'),
      struck: /<s[^>]*>Create the GitHub repository aeolus-fleet-memory-plugin<\/s>/.test(markup),
      icon: markup.includes('aria-label="Withdrawn"'),
      done: markup.includes('data-testid="bridge-step-done"'),
      note: markup.includes('data-testid="bridge-note"'),
      link: markup.includes('data-testid="bridge-step-link"'),
    }).toEqual({ stale: true, struck: true, icon: true, done: false, note: false, link: false });
  });

  it('links a replaced step to its replacement, named with when it was replaced', () => {
    const markup = render(aStep({ stale: { kind: 'replaced', replacementId: 'dlv_04', at: '2026-10-31T21:11:00.000Z', replacementTitle: 'Sign in to attio with the team account' } }));

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 21:11 UTC with “Sign in to attio with the team account”. Do the new step.'), icon: markup.includes('aria-label="Replaced"'), link: markup.includes('Open the new step'), done: markup.includes('data-testid="bridge-step-done"') }).toEqual({ stale: true, icon: true, link: true, done: false });
  });
});

describe('an alert opened in Bridge offers to send its ship a message (aeolus-fleet #1547)', () => {
  const alert = aQuestion({ from: 'watch', title: 'builder-gateway: no report change for 2 h', question: undefined, body: 'Its last report, 17:46.', alertShip: 'builder-gateway' });

  function renderSeen(delivery: FocusedDelivery, onSendMessage: ((ship: string) => void) | undefined): string {
    const noop = () => undefined;
    return renderToStaticMarkup(
      createElement(DeliveryCard, {
        delivery,
        isDoneOnSeeing: true,
        meetingHref: undefined,
        basketHref: '/bridge/basket?fleet=flt_01',
        inBasket: null,
        note: '',
        working: undefined,
        failure: undefined,
        onNoteChange: noop,
        onAnswer: noop,
        onPut: noop,
        onRemove: noop,
        onDone: noop,
        onFinishStep: noop,
        onOpen: noop,
        onSendMessage,
        onBack: noop,
      }),
    );
  }

  it("names the alert's ship on the button", () => {
    expect(renderSeen(alert, () => undefined)).toContain('Send builder-gateway a message');
  });

  it('offers no such button for a notice, which is about no ship', () => {
    expect(renderSeen({ ...alert, alertShip: undefined }, () => undefined)).not.toContain('data-testid="bridge-send-alert-ship"');
  });
});
