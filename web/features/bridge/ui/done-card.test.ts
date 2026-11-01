import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RecordItem } from '../services/items';
import { DoneCard } from './done-card';

// A done item opened from Done (decide.html, answered in Slack): read back
// whole, its options with the one answered marked, what came of it, and its
// history of where it showed and what was done where. Nothing to send.

const QUESTION = {
  id: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
  title: 'Which goes first: the Compact look (U4) or Harbour?',
  context: 'Both are approved and touch the same parts.',
  options: [
    { key: 1, label: 'Compact first (U4), then Harbour', detail: 'Harbour is built once.' },
    { key: 2, label: 'Harbour first, on today’s look', detail: 'Harbour shows a week sooner.' },
  ],
  pick: { option: 1, why: 'Harbour is drawn on Compact already.' },
};

function anItem(overrides: Partial<RecordItem> = {}): RecordItem {
  return {
    deliveryId: 'dlv_01',
    from: 'orchestrator-1',
    title: QUESTION.title,
    sentAt: '2026-10-31T19:41:00.000Z',
    job: 'decide',
    isAlert: false,
    state: 'done',
    places: ['slack', 'chat'],
    contentType: 'application/vnd.aeolus.question+json',
    payload: JSON.stringify(QUESTION),
    outcome: { place: 'slack', kind: 'answered', option: 2, optionLabel: 'Harbour first, on today’s look', note: null, seen: { place: 'slack', at: '2026-10-31T19:57:00.000Z' }, replacementTitle: null, at: '2026-10-31T19:58:00.000Z' },
    ...overrides,
  };
}

function render(item: RecordItem): string {
  return renderToStaticMarkup(createElement(DoneCard, { item, timeZone: 'UTC', bridgeHost: 'gateway.example', onBack: () => undefined }));
}

describe('a done item read back whole (decide.html)', () => {
  it('heads it with its job, who asked it and when it arrived', () => {
    const markup = render(anItem());

    expect([markup.includes('Decide'), markup.includes('question from'), markup.includes('19:41')]).toEqual([true, true, true]);
  });

  it('shows each option with its radio, filled on the one answered on the card ground with the ring border, and none to choose', () => {
    const markup = render(anItem());

    expect({
      marked: (markup.match(/data-answered="true"/g) ?? []).length,
      radios: (markup.match(/data-testid="bridge-done-radio"/g) ?? []).length,
      filled: (markup.match(/data-testid="bridge-done-radio" data-filled="true"/g) ?? []).length,
      inputs: markup.includes('type="radio"'),
      accent: /data-answered="true" class="[^"]*bg-accent/.test(markup),
      pick: markup.includes('Their pick'),
    }).toEqual({ marked: 1, radios: 2, filled: 1, inputs: false, accent: false, pick: true });
  });

  it('says what came of it, where and when, and what was sent as the person', () => {
    const markup = render(anItem());

    expect([markup.includes('Answered in Slack at 19:58: option 2, Harbour first, on today’s look'), markup.includes('Sent to orchestrator-1 as you. Slack&#x27;s post and the chat show the same answer.')]).toEqual([true, true]);
  });

  it('tells its history: arrived and where it showed, seen where, and what came of it', () => {
    const markup = render(anItem());

    expect([markup.includes('Arrived from orchestrator-1'), markup.includes('shown in Bridge, Slack, a chat'), markup.includes('Seen in Slack'), markup.includes('Answered in Slack: option 2')]).toEqual([true, true, true, true]);
  });

  it('reads a step back with why and where it was done, and its outcome with the note quoted', () => {
    const step = anItem({
      job: 'do',
      contentType: 'application/vnd.aeolus.step+json',
      payload: JSON.stringify({ id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create the GitHub repository', why: 'No ship can create one.', link: 'https://github.com/new' }),
      outcome: { place: 'bridge', kind: 'cannot', option: null, optionLabel: null, note: 'The name is taken.', seen: null, replacementTitle: null, at: '2026-10-31T20:05:00.000Z' },
    });

    const markup = render(step);

    expect([markup.includes('No ship can create one.'), markup.includes('github.com/new'), markup.includes('Cannot, in Bridge at 20:05'), markup.includes('“The name is taken.” Sent to orchestrator-1 as you.'), markup.includes('data-testid="bridge-step-link"')]).toEqual([true, true, true, true, false]);
  });

  it("reads an alert back with its body", () => {
    const alert = anItem({ job: 'stay-aware', isAlert: true, contentType: 'application/vnd.aeolus.alert+json', payload: JSON.stringify({ headline: 'builder-gateway: no report change for 2 h', body: 'Last report: *working*.' }), outcome: { place: 'bridge', kind: 'seen', option: null, optionLabel: null, note: null, seen: null, replacementTitle: null, at: '2026-10-31T19:49:00.000Z' } });

    const markup = render(alert);

    expect([markup.includes('Alert'), markup.includes('<em>working</em>'), markup.includes('Seen in Bridge at 19:49')]).toEqual([true, true, true]);
  });

  it('titles its own screen on a phone by what came of it, and keeps its history to a desktop, as drawn', () => {
    const markup = render(anItem());

    expect([/data-testid="bridge-item-screen-bar".*>Answered</.test(markup), /data-testid="bridge-done-history" class="[^"]*max-md:hidden/.test(markup)]).toEqual([true, true]);
  });
});
