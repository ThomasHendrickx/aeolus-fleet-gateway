import { describe, expect, it } from 'vitest';

import { ageOf, clockTimeOf, fromWordsOf, jobLabelOf, jobWordOf, outcomeTextOf, screenTitleOf, seenWordsOf, type RecordItem } from './items';

function anItem(overrides: Partial<RecordItem> = {}): RecordItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', isAlert: false, state: 'done', places: [], contentType: 'application/vnd.aeolus.question+json', payload: '{}', outcome: null, ...overrides };
}

describe('what came of an item and where, as Done says it (Bridge, CC4)', () => {
  it.each([
    [{ place: 'bridge', kind: 'seen', option: null }, 'Seen in Bridge'],
    [{ place: 'chat', kind: 'seen', option: null }, 'Seen in a chat'],
    [{ place: 'slack', kind: 'answered', option: 2 }, 'Answered in Slack: option 2'],
    [{ place: 'bridge', kind: 'answered', option: null }, 'Answered in Bridge'],
    [{ place: 'chat', kind: 'done', option: null }, 'Done in a chat'],
    [{ place: 'bridge', kind: 'withdrawn', option: null }, 'Withdrawn by its asker, seen in Bridge'],
    [{ place: 'chat', kind: 'replaced', option: null }, 'Replaced by its asker, seen in a chat'],
    [{ place: 'bridge', kind: 'notSent', option: 2 }, 'Not sent, removed in Bridge: option 2'],
  ] as const)('says %o as %s', (outcome, text) => {
    expect(outcomeTextOf(anItem({ outcome: { ...outcome, optionLabel: null, note: null, seen: null, replacementTitle: null, at: '2026-10-31T19:58:00.000Z' } }))).toBe(text);
  });

  it('says Done for one done with no outcome kept, as before Bridge or ended by the fleet', () => {
    expect(outcomeTextOf(anItem())).toBe('Done');
  });

  it('says an item still waiting is new, and one opened is seen and not done yet', () => {
    expect([outcomeTextOf(anItem({ state: 'new' })), outcomeTextOf(anItem({ state: 'seen' }))]).toEqual(['New', 'Seen, not done yet']);
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
