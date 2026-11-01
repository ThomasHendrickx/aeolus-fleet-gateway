import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FocusedDelivery } from '../services/deliveries';
import type { RoutedPlace } from '../services/routing';
import { DeliveryCard, infoLinesOf, putOf, type StepFinished } from './delivery-card';

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

function render(delivery: FocusedDelivery, shown: { inBasket?: { option: number | null; note: string | null } | null; note?: string; finished?: StepFinished | null; places?: readonly RoutedPlace[] } = {}): string {
  const { inBasket = null, note = '', finished = null, places } = shown;
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(DeliveryCard, {
      delivery,
      isDoneOnSeeing: false,
      meetingHref: undefined,
      basketHref: '/bridge/basket?fleet=flt_01',
      inBasket,
      finished,
      places,
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
      sendsAtOnce: markup.includes('Send option') || markup.includes('Send the note alone'),
    }).toEqual({ choices: 3, picked: true, theirPick: true, put: true, sendsAtOnce: false });
  });

  it('says a question whose answer is in the basket is in it, not sent, with its note, its option picked, the basket and Remove beside it', () => {
    const markup = render(aQuestion(), { inBasket: { option: 1, note: 'U4 first, then Harbour.' } });

    expect({
      inBasket: markup.includes('In the basket: option 1, not sent'),
      note: markup.includes('&quot;U4 first, then Harbour.&quot;'),
      picked: markup.includes('checked="" value="1"'),
      basket: markup.includes('href="/bridge/basket?fleet=flt_01"'),
      remove: markup.includes('data-testid="bridge-basket-remove"'),
    }).toEqual({ inBasket: true, note: true, picked: true, basket: true, remove: true });
  });

  it('offers No option, only the note, among the options, for an answer with the note alone', () => {
    const markup = render(aQuestion());

    expect({ choices: (markup.match(/type="radio"/g) ?? []).length, noteAlone: markup.includes('No option, only the note'), secondButton: markup.includes('data-testid="bridge-put-note-alone"') }).toEqual({ choices: 3, noteAlone: true, secondButton: false });
  });

  it('opens a question whose note alone is in the basket with No option, only the note chosen', () => {
    const markup = render(aQuestion(), { inBasket: { option: null, note: 'Neither: ask me after the demo.' }, note: 'Neither: ask me after the demo.' });

    expect(markup.includes('checked="" value=""')).toBe(true);
  });

  it('says a question whose note alone is in the basket is in it, not sent, with its note', () => {
    const markup = render(aQuestion(), { inBasket: { option: null, note: 'Neither: ask me after the demo.' } });

    expect({ inBasket: markup.includes('In the basket: the note alone, not sent'), note: markup.includes('&quot;Neither: ask me after the demo.&quot;') }).toEqual({ inBasket: true, note: true });
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

describe("Decide's words (decide.html, basket.html)", () => {
  it('shows the note field always open, in the words basket.html gives it, with no Add a note button and no placeholder (BH1)', () => {
    const markup = render(aQuestion());

    expect({
      label: markup.includes('>Note (optional)<'),
      help: markup.includes('>Goes with the answer.<'),
      placeholder: /<textarea[^>]*data-testid="bridge-note"[^>]*placeholder=/.test(markup),
      grows: /<textarea[^>]*data-testid="bridge-note"[^>]*class="[^"]*field-sizing-content/.test(markup),
      addANote: markup.includes('Add a note'),
    }).toEqual({ label: true, help: true, placeholder: false, grows: true, addANote: false });
  });

  it('marks the button putting the answer in the basket with the basket icon', () => {
    const markup = render(aQuestion());

    expect(/data-testid="bridge-put-in-basket"[^>]*>(?:(?!<\/button>).)*lucide-shopping-basket/.test(markup)).toBe(true);
  });

  it("says the asker's pick behind the info icon on a question opened at their pick, and not that nothing is sent yet (decide-1)", () => {
    const markup = render(aQuestion());

    expect({
      pick: /lucide-info(?:(?!<\/p>).)*orchestrator-1 picks 2: The demo on 12 Nov needs it\./.test(markup),
      nothingSent: markup.includes('Nothing is sent yet.'),
    }).toEqual({ pick: true, nothingSent: false });
  });

  it("leaves out the asker's pick on a question in the basket (basket-2)", () => {
    const markup = render(aQuestion(), { inBasket: { option: 2, note: 'Harbour first.' } });

    expect(markup.includes('orchestrator-1 picks 2')).toBe(false);
  });

  it('spans the button putting the answer across the card on a phone, back to its own width from the small breakpoint', () => {
    const markup = render(aQuestion());
    const button = /<button[^>]*data-testid="bridge-put-in-basket"[^>]*>/.exec(markup)?.[0] ?? '';

    expect({ full: /class="[^"]*\bw-full\b/.test(button) && button.includes('justify-center'), own: button.includes('sm:w-auto') && button.includes('sm:justify-self-start') }).toEqual({ full: true, own: true });
  });

  it('draws the note field without a resize grip, as it grows with its note', () => {
    expect(/<textarea[^>]*data-testid="bridge-note"[^>]*class="[^"]*resize-none/.test(render(aQuestion()))).toBe(true);
  });

  it('names where the question shows under it, behind the eye icon', () => {
    const markup = render(aQuestion(), { places: ['slack', 'chat'] });

    expect(/data-testid="bridge-shown-in"(?:(?!<\/footer>).)*lucide-eye(?:(?!<\/footer>).)*Shows in Bridge, Slack and a chat, as Where things show sets for Decide\. One answer, wherever you give it\./.test(markup)).toBe(true);
  });

  it('names no places where the page did not read them', () => {
    expect(render(aQuestion()).includes('data-testid="bridge-shown-in"')).toBe(false);
  });

  it('names no places for a step, or a question its asker withdrew', () => {
    const step = render(aQuestion({ question: undefined, step: { title: 'Sign in', why: 'Only you can.', link: undefined } }), { places: ['slack'] });
    const withdrawn = render(aQuestion({ stale: { kind: 'withdrawn', replacementId: null, at: '2026-10-31T20:09:00.000Z', replacementTitle: null } }), { places: ['slack'] });

    expect({ step: step.includes('data-testid="bridge-shown-in"'), withdrawn: withdrawn.includes('data-testid="bridge-shown-in"') }).toEqual({ step: false, withdrawn: false });
  });

  it('shows a question in the basket in the info tone, with the basket icon, its note and how to change it on one line', () => {
    const markup = render(aQuestion(), { inBasket: { option: 2, note: 'Harbour first: the demo on 12 Nov needs it.' } });

    expect({
      tone: /<div data-testid="bridge-in-basket"[^>]*border-tone-active-border bg-tone-active-bg/.test(markup),
      icon: /data-testid="bridge-in-basket"(?:(?!data-testid="bridge-basket-open").)*lucide-shopping-basket/.test(markup),
      oneLine: markup.includes('&quot;Harbour first: the demo on 12 Nov needs it.&quot; Pick another option to change it.'),
    }).toEqual({ tone: true, icon: true, oneLine: true });
  });

  it('shows a question in the basket with the box alone: no note field and no button putting the same answer again', () => {
    const markup = render(aQuestion(), { inBasket: { option: 2, note: 'Harbour first.' }, note: 'Harbour first.' });

    expect({ note: markup.includes('data-testid="bridge-note"'), put: markup.includes('data-testid="bridge-put-in-basket"') }).toEqual({ note: false, put: false });
  });
});

describe('what the button under a question puts in the basket', () => {
  it('puts the option chosen, with or without a note', () => {
    expect(putOf({ chosen: 2, inBasket: null, note: '' })).toEqual({ label: 'Put option 2 in the basket', isReady: true });
  });

  it('puts the note alone only once there is a note', () => {
    expect({ empty: putOf({ chosen: null, inBasket: null, note: '  ' }), written: putOf({ chosen: null, inBasket: null, note: 'Neither.' }) }).toEqual({
      empty: { label: 'Put the note alone in the basket', isReady: false },
      written: { label: 'Put the note alone in the basket', isReady: true },
    });
  });

  it('offers nothing to put while the choice is what the basket holds', () => {
    expect({ option: putOf({ chosen: 2, inBasket: { option: 2, note: null }, note: '' }), noteAlone: putOf({ chosen: null, inBasket: { option: null, note: 'Neither.' }, note: 'Neither.' }) }).toEqual({ option: null, noteAlone: null });
  });

  it('puts another option picked while one is in the basket, which changes the entry', () => {
    expect(putOf({ chosen: 1, inBasket: { option: 2, note: 'Harbour first.' }, note: 'Harbour first.' })).toEqual({ label: 'Put option 1 in the basket', isReady: true });
  });

  it('offers nothing to put before an option is chosen', () => {
    expect(putOf({ chosen: undefined, inBasket: null, note: '' })).toBeNull();
  });
});

describe('which info lines a question says (decide.html, basket.html)', () => {
  const PICK = 2;

  it("says the asker's pick, and not that nothing is sent yet, while the choice is their pick and nothing is in the basket (decide-1)", () => {
    expect(infoLinesOf({ chosen: PICK, pick: PICK, inBasket: null, isStale: false })).toEqual({ isPickSaid: true, isNothingSentSaid: false });
  });

  it("says nothing is sent yet, and not the asker's pick, once another option is chosen (basket-1)", () => {
    expect(infoLinesOf({ chosen: 1, pick: PICK, inBasket: null, isStale: false })).toEqual({ isPickSaid: false, isNothingSentSaid: true });
  });

  it('says neither while the choice is what the basket holds (basket-2)', () => {
    expect(infoLinesOf({ chosen: PICK, pick: PICK, inBasket: { option: PICK, note: null }, isStale: false })).toEqual({ isPickSaid: false, isNothingSentSaid: false });
  });

  it('says nothing is sent yet once another option is chosen while one is in the basket', () => {
    expect(infoLinesOf({ chosen: 1, pick: PICK, inBasket: { option: PICK, note: null }, isStale: false })).toEqual({ isPickSaid: false, isNothingSentSaid: true });
  });

  it("keeps the asker's pick on a question its asker withdrew or replaced, with nothing to send", () => {
    expect(infoLinesOf({ chosen: PICK, pick: PICK, inBasket: null, isStale: true })).toEqual({ isPickSaid: true, isNothingSentSaid: false });
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
        finished: null,
        note: '',
        working: undefined,
        failure: undefined,
        places: undefined,
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
