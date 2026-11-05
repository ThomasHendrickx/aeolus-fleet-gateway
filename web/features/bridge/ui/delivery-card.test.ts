import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FocusedDelivery } from '../services/deliveries';
import type { RoutedPlace } from '../services/routing';
import { DeliveryCard, infoLinesOf, putOf, sendLabelOf, type DeliveryControl, type Opened, type StepFinished } from './delivery-card';

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
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: QUESTION.title, sentAt: '2026-10-31T19:41:00.000Z', payload: JSON.stringify(QUESTION), body: JSON.stringify(QUESTION), question: QUESTION, step: undefined, alert: undefined, meetingId: undefined, stale: null, ...overrides };
}

/** How an item was opened: its job, whether an alert, and whether it was new; a step's, a question's or an alert's by default. */
function openedOf(delivery: FocusedDelivery): Opened {
  if (delivery.step !== undefined) {
    return { job: 'do', isAlert: false, wasNew: true };
  }
  return delivery.question === undefined ? { job: 'stay-aware', isAlert: true, wasNew: true } : { job: 'decide', isAlert: false, wasNew: true };
}

function render(delivery: FocusedDelivery, shown: { inBasket?: { option: number | null; note: string | null } | null; note?: string; finished?: StepFinished | null; places?: readonly RoutedPlace[]; opened?: Opened; working?: DeliveryControl; failure?: string } = {}): string {
  const { inBasket = null, note = '', finished = null, places, opened = openedOf(delivery), working, failure } = shown;
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(DeliveryCard, {
      delivery,
      opened,
      timeZone: 'UTC',
      meetingHref: undefined,
      consoleUrl: 'https://fleet.aeolus-fleet.dev',
      basketHref: '/bridge/basket?fleet=flt_01',
      inBasket,
      finished,
      places,
      note,
      working,
      failure,
      onNoteChange: noop,
      onAnswer: noop,
      onPut: noop,
      onSend: noop,
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
    }).toEqual({ choices: 3, picked: true, theirPick: true, put: true });
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

    expect({ stale: markup.includes('Withdrawn by orchestrator-1 at 20:09. Nothing to answer: it is done.'), send: markup.includes('in the basket'), note: markup.includes('data-testid="bridge-note"') }).toEqual({ stale: true, send: false, note: false });
  });

  it('links a replaced question to its replacement', () => {
    const markup = render(aQuestion({ stale: { kind: 'replaced', replacementId: 'dlv_02', at: '2026-10-31T20:10:00.000Z', replacementTitle: 'Which goes first, now that U4 slipped?' } }));

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 20:10 with “Which goes first, now that U4 slipped?”. Answer the new question.'), link: markup.includes('data-testid="bridge-replacement"'), send: markup.includes('in the basket') }).toEqual({ stale: true, link: true, send: false });
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
    return { deliveryId: 'dlv_03', from: 'orchestrator-1', title: STEP.title, sentAt: '2026-10-31T20:00:00.000Z', payload: '{}', body: '{}', question: undefined, step: STEP, alert: undefined, meetingId: undefined, stale: null, ...overrides };
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
      title: markup.includes('Done in Bridge at 20:03'),
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
      title: markup.includes('Cannot, in Bridge at 20:05'),
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
      stale: markup.includes('Withdrawn by orchestrator-1 at 21:09. Nothing to do: it is done.'),
      struck: /<s[^>]*>Create the GitHub repository aeolus-fleet-memory-plugin<\/s>/.test(markup),
      icon: markup.includes('aria-label="Withdrawn"'),
      done: markup.includes('data-testid="bridge-step-done"'),
      note: markup.includes('data-testid="bridge-note"'),
      link: markup.includes('data-testid="bridge-step-link"'),
    }).toEqual({ stale: true, struck: true, icon: true, done: false, note: false, link: false });
  });

  it('links a replaced step to its replacement, named with when it was replaced', () => {
    const markup = render(aStep({ stale: { kind: 'replaced', replacementId: 'dlv_04', at: '2026-10-31T21:11:00.000Z', replacementTitle: 'Sign in to attio with the team account' } }));

    expect({ stale: markup.includes('Replaced by orchestrator-1 at 21:11 with “Sign in to attio with the team account”. Do the new step.'), icon: markup.includes('aria-label="Replaced"'), link: markup.includes('Open the new step'), done: markup.includes('data-testid="bridge-step-done"') }).toEqual({ stale: true, icon: true, link: true, done: false });
  });
});

// An opened item (aeolus-fleet#1538): its heading names the job, who sent it, the time of day and whether it was
// seen; its text is Markdown; on a phone it is its own screen, back to the list by its chevron (decide.html, do.html,
// stay-aware.html).
describe('an opened item’s heading, text and screen (aeolus-fleet#1538)', () => {
  const ALERT_BODY = 'Its last report, 17:46: *Working: slice W9, the waiter’s restart test.* You expect a report change within 45 min.';

  function anAlert(): FocusedDelivery {
    return { deliveryId: 'dlv_05', from: 'watch', title: 'builder-gateway: no report change for 2 h', sentAt: '2026-10-31T19:47:00.000Z', payload: '{}', body: ALERT_BODY, question: undefined, step: undefined, alert: undefined, meetingId: undefined, stale: null };
  }

  /** The heading line above the title, as text. */
  function headingOf(markup: string): string {
    return (/<p data-testid="bridge-item-heading"[^>]*>(.*?)<\/p>/.exec(markup)?.[1] ?? '').replaceAll(/<[^>]+>/g, '');
  }

  it('heads a new question with its job, who asked, the time of day and that it is seen just now, with no date', () => {
    const markup = render(aQuestion());

    expect({ heading: headingOf(markup), asker: markup.includes('<strong class="font-semibold text-foreground">orchestrator-1</strong>'), date: /GMT|UTC|2026/.test(headingOf(markup)) }).toEqual({ heading: 'Decide·question from orchestrator-1·19:41·Seen just now', asker: true, date: false });
  });

  it('heads a step seen before with no word of seeing it', () => {
    expect(headingOf(render(aQuestion({ question: undefined, step: { title: 'Create the repository', why: 'No ship can.', link: undefined } }), { opened: { job: 'do', isAlert: false, wasNew: false } }))).toBe('Do·step from orchestrator-1·19:41');
  });

  it('heads an alert in its tone, seen now, so done, and says no more of it below', () => {
    const markup = render(anAlert());

    expect({ heading: headingOf(markup), tone: /data-testid="bridge-item-heading"(?:(?!<\/p>).)*text-tone-attention-fg[^>]*>(?:<svg(?:(?!<\/svg>).)*<\/svg>)?Alert/.test(markup), below: markup.includes('it asks nothing more') }).toEqual({ heading: 'Alert·from watch·19:47·Seen now, so done', tone: true, below: false });
  });

  it('shows an alert’s body as Markdown, not as code', () => {
    const markup = render(anAlert());

    expect({ italics: markup.includes('<em>Working: slice W9, the waiter’s restart test.</em>'), pre: markup.includes('<pre') }).toEqual({ italics: true, pre: false });
  });

  it('shows a question’s context and a step’s why as Markdown', () => {
    const question = render(aQuestion({ question: { ...QUESTION, context: 'Both touch `@aeolus-fleet/ui`.' } }));
    const step = render(aQuestion({ question: undefined, step: { title: 'Create the repository', why: 'Create it with `main` as its default branch.', link: undefined } }));

    expect({ context: /<code[^>]*>@aeolus-fleet\/ui<\/code>/.test(question), why: /<code[^>]*>main<\/code>/.test(step) }).toEqual({ context: true, why: true });
  });

  it('shows only the first paragraph of a question’s context and a step’s why on a phone, as the sheets draw them', () => {
    const question = render(aQuestion({ question: { ...QUESTION, context: 'One.\n\nTwo.' } }));
    const step = render(aQuestion({ question: undefined, step: { title: 'Create the repository', why: 'One.\n\nTwo.', link: undefined } }));
    const firstOnly = /<div class="[^"]*max-md:\[&amp;_p\+p\]:hidden[^"]*"><div[^>]*><p[^>]*>One\.<\/p>/;

    expect({ context: firstOnly.test(question), why: firstOnly.test(step) }).toEqual({ context: true, why: true });
  });

  it('shows a question’s options by their labels alone on a phone, their details from a desktop up', () => {
    const markup = render(aQuestion());
    const classesOf = (detail: string) => (new RegExp(`<span class="([^"]*)">${detail}</span>`).exec(markup)?.[1] ?? '').split(' ');

    expect([classesOf('Harbour is built once\\.').includes('max-md:hidden'), classesOf('Answer with your note alone\\.').includes('max-md:hidden')]).toEqual([true, true]);
  });

  it('is its own screen on a phone, titled by its job, back to the list by its chevron, and has no Back beside the list on a desktop', () => {
    const markup = render(aQuestion());
    const screenBar = /<div data-testid="bridge-item-screen-bar" class="([^"]*)"[^>]*>(.*?)<\/div>/.exec(markup);

    expect({
      // The shell's top bar titles it on a phone (#242 review): this bar only fills the width between.
      phoneOnly: ['hidden', 'sm:flex', 'md:hidden'].every((each) => (screenBar?.[1] ?? '').split(' ').includes(each)),
      back: /<button[^>]*aria-label="Back to the list"/.test(screenBar?.[2] ?? ''),
      chevron: (screenBar?.[2] ?? '').includes('lucide-chevron-left'),
      title: (screenBar?.[2] ?? '').includes('>Question<'),
      backs: (markup.match(/>Back</g) ?? []).length,
    }).toEqual({ phoneOnly: true, back: true, chevron: true, title: true, backs: 0 });
  });
});

describe('a question opened in Bridge can be answered at once, bypassing the basket (aeolus-fleet-gateway#202)', () => {
  const buttonOf = (markup: string, testId: string) => new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`).exec(markup)?.[0] ?? '';
  const colourOf = (button: string) => /bg-primary text-primary-foreground hover:bg-primary-hover/.exec(button)?.[0];

  it('offers a Send button beside the basket one, in its colour, naming the chosen option', () => {
    const markup = render(aQuestion());

    expect({ send: markup.includes('>Send option 2<'), sameColour: colourOf(buttonOf(markup, 'bridge-send-answer')) === colourOf(buttonOf(markup, 'bridge-put-in-basket')) && colourOf(buttonOf(markup, 'bridge-send-answer')) !== undefined }).toEqual({ send: true, sameColour: true });
  });

  it('words the Send button by the option chosen, or the note alone', () => {
    expect({ option: sendLabelOf(1), noteAlone: sendLabelOf(null) }).toEqual({ option: 'Send option 1', noteAlone: 'Send the note alone' });
  });

  it('shows pending at once: a spinner and its working label, disabled, the basket button disabled too', () => {
    const markup = render(aQuestion(), { working: { kind: 'send' } });

    const send = new RegExp('<button[^>]*data-testid="bridge-send-answer"[^>]*>(?:(?!</button>).)*</button>').exec(markup)?.[0] ?? '';

    expect({
      busy: send.includes('aria-busy="true"') && send.includes('disabled=""'),
      spinner: send.includes('animate-spin'),
      label: send.includes('Sending...'),
      basketDisabled: /<button[^>]*data-testid="bridge-put-in-basket"[^>]*disabled=""/.test(markup),
    }).toEqual({ busy: true, spinner: true, label: true, basketDisabled: true });
  });

  it('says a failure inline by the buttons, keeping the choice and the note', () => {
    const markup = render(aQuestion(), { failure: 'The fleet did not take your answer: it is down', note: 'Wait for U4.' });

    expect({ failure: markup.includes('The fleet did not take your answer: it is down'), choice: markup.includes('checked="" value="2"'), note: markup.includes('>Wait for U4.</textarea>'), sendBack: markup.includes('>Send option 2<') }).toEqual({ failure: true, choice: true, note: true, sendBack: true });
  });
});

describe('an alert opened in Bridge offers to send its ship a message (aeolus-fleet #1547)', () => {
  const alert = aQuestion({ from: 'watch', title: 'builder-gateway: no report change for 2 h', question: undefined, body: 'Its last report, 17:46.', alertShip: 'builder-gateway' });

  function renderSeen(delivery: FocusedDelivery, onSendMessage: ((ship: string) => void) | undefined): string {
    const noop = () => undefined;
    return renderToStaticMarkup(
      createElement(DeliveryCard, {
        delivery,
        opened: { job: 'stay-aware', isAlert: true, wasNew: true },
        timeZone: 'UTC',
        meetingHref: undefined,
        consoleUrl: undefined,
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
      onSend: noop,
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

describe('an alert or a notice opened in Bridge (stay-aware.html)', () => {
  const ship = { id: 'shp_01m6bw3rg8n3xmqe91x19xm3y7', name: 'builder-gateway' };

  it("shows an alert's ship as the alert left it, its Health in the console and what clears it", () => {
    const markup = render(aQuestion({ from: 'watch', title: 'builder-gateway: no report change for 2 h', question: undefined, alert: { ship, signal: 'report-unchanged' } }));

    expect({
      tile: markup.includes('data-testid="bridge-alert-tile"'),
      health: markup.includes('href="https://fleet.aeolus-fleet.dev/ships/shp_01m6bw3rg8n3xmqe91x19xm3y7"'),
      clears: markup.includes('The alert clears when builder-gateway reports again'),
      answer: markup.includes('data-testid="bridge-note"'),
    }).toEqual({ tile: true, health: true, clears: true, answer: false });
  });

  it('shows a notice with no ship, Health or info line', () => {
    const markup = render(aQuestion({ from: 'trierarch', title: 'trierarch plugin 0.35.1 released', question: undefined }), { opened: { job: 'stay-aware', isAlert: false, wasNew: true } });

    expect({ tile: markup.includes('data-testid="bridge-alert-tile"'), health: markup.includes('Health'), clears: markup.includes('data-testid="bridge-alert-clears"') }).toEqual({ tile: false, health: false, clears: false });
  });
});

describe('an opened plain message (#242 review)', () => {
  const MESSAGE = aQuestion({ title: 'Staging is green again after the migration', payload: 'Staging is green again after the migration\nThe migration ran.', body: 'The migration ran.', question: undefined });

  it('says under its answer field that it is optional and goes to the sender as the person, the field at a reading width', () => {
    const markup = render(MESSAGE, { opened: { job: 'everything-else', isAlert: false, wasNew: true } });

    expect({ hint: markup.includes('Optional. Sent to orchestrator-1 as you.'), width: /<label class="[^"]*max-w-\[620px\]/.test(markup) }).toEqual({ hint: true, width: true });
  });

  it('draws a check before Done', () => {
    expect(/data-testid="bridge-done"[^>]*><svg[^>]*lucide-check/.test(render(MESSAGE, { opened: { job: 'everything-else', isAlert: false, wasNew: true } }))).toBe(true);
  });
});
