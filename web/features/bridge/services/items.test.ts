import { describe, expect, it } from 'vitest';

import { ageOf, jobLabelOf, jobWordOf, outcomeTextOf, type RecordItem } from './items';

function anItem(overrides: Partial<RecordItem> = {}): RecordItem {
  return { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first?', sentAt: '2026-10-31T19:48:00.000Z', job: 'decide', state: 'done', outcome: null, ...overrides };
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
    expect(outcomeTextOf(anItem({ outcome: { ...outcome, at: '2026-10-31T19:58:00.000Z' } }))).toBe(text);
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
