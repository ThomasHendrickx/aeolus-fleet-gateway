import { describe, expect, it } from 'vitest';

import { ageOf, clockTimeOf, dayOf, doneOutcomeOf, endedOf, fromWordsOf, historyOf, jobLabelOf, jobWordOf, screenTitleOf, seenWordsOf, type RecordItem } from './items';

function anItem(overrides: Partial<RecordItem> = {}): RecordItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', isAlert: false, state: 'done', places: [], contentType: 'application/vnd.aeolus.question+json', payload: '{}', outcome: null, ...overrides };
}

type Outcome = NonNullable<RecordItem['outcome']>;

function anOutcome(overrides: Partial<Outcome>): Outcome {
  return { place: 'bridge', kind: 'seen', option: null, optionLabel: null, note: null, seen: null, replacementTitle: null, at: '2026-10-31T19:58:00.000Z', ...overrides };
}

describe('what came of an item and where, on its row in Done (done.html)', () => {
  it.each<[Partial<Outcome>, string]>([
    [{ place: 'bridge', kind: 'seen' }, 'Seen in Bridge'],
    [{ place: 'chat', kind: 'seen' }, 'Seen in a chat'],
    [{ place: 'slack', kind: 'answered', option: 2, optionLabel: 'Harbour first' }, 'Answered in Slack: option 2, Harbour first'],
    [{ place: 'chat', kind: 'answered', option: 1, optionLabel: 'Fleet', note: 'It says what it is.' }, 'Answered in a chat: option 1, Fleet, with the note “It says what it is.”'],
    [{ place: 'bridge', kind: 'answered', note: 'Ask me after the demo.' }, 'Answered in Bridge with the note “Ask me after the demo.”'],
    [{ place: 'bridge', kind: 'answered', option: 3 }, 'Answered in Bridge: option 3'],
    [{ place: 'bridge', kind: 'cannot', note: 'The name is taken by an archived repository of mine.' }, 'Cannot, in Bridge: “The name is taken by an archived repository of mine.”'],
    [{ place: 'chat', kind: 'cannot' }, 'Cannot, in a chat'],
    [{ place: 'bridge', kind: 'done', note: 'Created; private for now.' }, 'Done in Bridge: “Created; private for now.”'],
    [{ place: 'slack', kind: 'done' }, 'Done in Slack'],
    [{ place: 'gateway', kind: 'done' }, 'Done: the gateway saw it complete'],
    [{ place: 'bridge', kind: 'withdrawn' }, 'Withdrawn by orchestrator-1'],
    [{ place: 'bridge', kind: 'replaced', replacementTitle: 'Release core 0.42.0 after #1488?' }, 'Withdrawn by orchestrator-1, replaced by “Release core 0.42.0 after #1488?”'],
    [{ place: 'bridge', kind: 'replaced' }, 'Replaced by orchestrator-1'],
    [{ place: 'bridge', kind: 'notSent', option: 2, optionLabel: 'Harbour first' }, 'Not sent, removed in Bridge: option 2, Harbour first'],
  ])('says %o as %s', (outcome, text) => {
    expect(doneOutcomeOf(anItem({ outcome: anOutcome(outcome) })).text).toBe(text);
  });

  it('says Done for one the fleet ended with no outcome kept', () => {
    expect(doneOutcomeOf(anItem()).text).toBe('Done');
  });

  it('marks seen, answered and done as ended well, and cannot, withdrawn, replaced and not sent as ended otherwise', () => {
    const kinds = ['seen', 'answered', 'done', 'cannot', 'withdrawn', 'replaced', 'notSent'] as const;

    expect(kinds.map((kind) => doneOutcomeOf(anItem({ outcome: anOutcome({ kind }) })).isOk)).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('a done item opened, with what came of it and its history (decide.html, answered in Slack)', () => {
  const ANSWERED = anItem({ places: ['slack', 'chat'], sentAt: '2026-10-31T19:41:00.000Z', outcome: anOutcome({ place: 'slack', kind: 'answered', option: 2, optionLabel: 'Harbour first', seen: { place: 'slack', at: '2026-10-31T19:57:00.000Z' } }) });

  it('says what came of it, where and when, and what was sent as the person', () => {
    expect(endedOf(ANSWERED, 'UTC')).toEqual({ isOk: true, text: 'Answered in Slack at 19:58: option 2, Harbour first', sent: 'Sent to orchestrator-1 as you.' });
  });

  it('quotes the note sent with a step outcome, and says nothing was sent for one only seen', () => {
    const cannot = anItem({ job: 'do', outcome: anOutcome({ kind: 'cannot', note: 'The name is taken.' }) });
    const seen = anItem({ job: 'stay-aware', outcome: anOutcome({ kind: 'seen' }) });

    expect([endedOf(cannot, 'UTC'), endedOf(seen, 'UTC')]).toEqual([
      { isOk: false, text: 'Cannot, in Bridge at 19:58', sent: '“The name is taken.” Sent to orchestrator-1 as you.' },
      { isOk: true, text: 'Seen in Bridge at 19:58', sent: undefined },
    ]);
  });

  it('tells its history: arrived and where it showed, seen where, and what came of it, done', () => {
    expect(historyOf(ANSWERED, 'UTC')).toEqual([
      { at: '19:41', text: 'Arrived from orchestrator-1', detail: 'shown in Bridge, Slack, a chat', isEnd: false },
      { at: '19:57', text: 'Seen in Slack', detail: undefined, isEnd: false },
      { at: '19:58', text: 'Answered in Slack: option 2', detail: 'done', isEnd: true },
    ]);
  });

  it('tells seen once for an item whose outcome is seeing it', () => {
    const seen = anItem({ job: 'stay-aware', outcome: anOutcome({ kind: 'seen', seen: { place: 'bridge', at: '2026-10-31T19:58:00.000Z' } }) });

    expect(historyOf(seen, 'UTC').map(({ text }) => text)).toEqual(['Arrived from orchestrator-1', 'Seen in Bridge']);
  });

  it('tells the fleet ended it when no outcome was kept', () => {
    expect(historyOf(anItem(), 'UTC').map(({ text, isEnd }) => ({ text, isEnd }))).toEqual([
      { text: 'Arrived from orchestrator-1', isEnd: false },
    ]);
  });
});

describe('the day Done groups items under (done.html: Today)', () => {
  const NOW = new Date('2026-11-01T20:00:00.000Z');

  it.each([
    ['2026-11-01T00:10:00.000Z', 'Today'],
    ['2026-10-31T23:59:00.000Z', 'Yesterday'],
    ['2026-10-30T12:00:00.000Z', '30 Oct'],
  ])('puts %s under %s', (at, day) => {
    expect(dayOf(at, { now: NOW, timeZone: 'UTC' })).toBe(day);
  });

  it("counts days in the person's own time zone", () => {
    expect(dayOf('2026-10-31T23:30:00.000Z', { now: NOW, timeZone: 'Europe/Brussels' })).toBe('Today');
  });
});

describe("an item's job, as Bridge labels it (CC10)", () => {
  it.each([
    ['decide', 'Decide'],
    ['do', 'Do'],
    ['stay-aware', 'Stay aware'],
    ['everything-else', 'Message'],
  ] as const)('labels %s as %s', (job, label) => {
    expect(jobLabelOf(job)).toBe(label);
  });
});

describe("an item's job word on its row, an alert told from a notice (aeolus-fleet#1535)", () => {
  it.each([
    [{ job: 'decide', isAlert: false }, 'Decide'],
    [{ job: 'do', isAlert: false }, 'Do'],
    [{ job: 'stay-aware', isAlert: true }, 'Alert'],
    [{ job: 'stay-aware', isAlert: false }, 'Notice'],
    [{ job: 'everything-else', isAlert: false }, 'Message'],
  ] as const)('words %o as %s', (item, word) => {
    expect(jobWordOf(item)).toBe(word);
  });
});

describe('how long ago an item arrived, on its row (aeolus-fleet#1535)', () => {
  const NOW = new Date('2026-11-01T20:00:00.000Z');

  it.each([
    ['2026-11-01T19:59:31.000Z', 'now'],
    ['2026-11-01T19:59:00.000Z', '1 min'],
    ['2026-11-01T19:48:00.000Z', '12 min'],
    ['2026-11-01T19:00:01.000Z', '59 min'],
    ['2026-11-01T19:00:00.000Z', '1 h'],
    ['2026-10-31T20:00:01.000Z', '23 h'],
    ['2026-10-31T20:00:00.000Z', 'yesterday'],
    ['2026-10-30T20:00:01.000Z', 'yesterday'],
    ['2026-10-30T20:00:00.000Z', '2 d'],
  ])('says one sent at %s as %s', (sentAt, age) => {
    expect(ageOf(sentAt, NOW)).toBe(age);
  });

  it('says now for one sent a moment after the page read the time', () => {
    expect(ageOf('2026-11-01T20:00:02.000Z', NOW)).toBe('now');
  });
});

describe('the time of day on an opened item, in the person’s own time (aeolus-fleet#1538)', () => {
  it('says the hour and minute alone, with no date and no UTC', () => {
    expect(clockTimeOf('2026-10-31T19:41:00.000Z', 'UTC')).toBe('19:41');
  });

  it('says it in the time zone it is read in', () => {
    expect(clockTimeOf('2026-10-31T19:41:00.000Z', 'Europe/Brussels')).toBe('20:41');
  });

  it('says the first minutes of a day from 00, not 24', () => {
    expect(clockTimeOf('2026-10-31T23:05:00.000Z', 'Europe/Brussels')).toBe('00:05');
  });
});

describe('the heading of an opened item (decide.html, do.html, stay-aware.html)', () => {
  it.each([
    [{ job: 'decide', isAlert: false }, 'question from'],
    [{ job: 'do', isAlert: false }, 'step from'],
    [{ job: 'stay-aware', isAlert: true }, 'from'],
    [{ job: 'stay-aware', isAlert: false }, 'from'],
    [{ job: 'everything-else', isAlert: false }, 'from'],
  ] as const)('names who sent %o as %s', (item, words) => {
    expect(fromWordsOf(item)).toBe(words);
  });

  it.each([
    [{ wasNew: true, isDoneOnSeeing: false }, 'Seen just now'],
    [{ wasNew: false, isDoneOnSeeing: false }, undefined],
    [{ wasNew: true, isDoneOnSeeing: true }, 'Seen now, so done'],
    [{ wasNew: false, isDoneOnSeeing: true }, 'Seen, so done'],
  ])('says %o as %s', (opened, words) => {
    expect(seenWordsOf(opened)).toBe(words);
  });
});

describe('the title of an item’s own screen on a phone (decide.html, do.html)', () => {
  it.each([
    [{ job: 'decide', isAlert: false }, 'Question'],
    [{ job: 'do', isAlert: false }, 'Step'],
    [{ job: 'stay-aware', isAlert: true }, 'Alert'],
    [{ job: 'stay-aware', isAlert: false }, 'Notice'],
    [{ job: 'everything-else', isAlert: false }, 'Message'],
  ] as const)('titles %o as %s', (item, title) => {
    expect(screenTitleOf(item)).toBe(title);
  });
});
