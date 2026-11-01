import { describe, expect, it } from 'vitest';

import { turnedMessageOf } from './routing';

// What Bridge says once a place was turned on or off for a job (Bridge,
// section 8, CC20): a pull place shows every item of the job not done; a
// push place only what arrives after; Bridge keeps every item.

describe('what a change of routing says', () => {
  it('says a chat turned on lists every item of the job not done', () => {
    expect(turnedMessageOf({ job: 'decide', place: 'chat', isOn: true })).toBe('A chat is on for Decide: it lists every question not done when you ask it.');
  });

  it('says a push place turned on shows only what arrives from now on, the rest staying in Bridge', () => {
    expect(turnedMessageOf({ job: 'decide', place: 'slack', isOn: true })).toBe('Slack is on for Decide: it shows questions that arrive from now on. Those already waiting stay in Bridge.');
  });

  it('says a place turned off no longer shows the job, Bridge keeping every item', () => {
    expect(turnedMessageOf({ job: 'stay-aware', place: 'web-push', isOn: false })).toBe('Web push is off for Stay aware. Bridge keeps every item.');
  });

  it("says Slack off for everything else still shows a bot ship's messages there", () => {
    expect(turnedMessageOf({ job: 'everything-else', place: 'slack', isOn: false })).toBe("Slack is off for Everything else: only a bot ship's messages and replies to Slack show there. Bridge keeps every item.");
  });
});
