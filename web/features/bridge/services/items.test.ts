import { describe, expect, it } from 'vitest';

import { jobLabelOf, outcomeTextOf, type RecordItem } from './items';

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
