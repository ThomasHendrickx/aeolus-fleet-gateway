import { describe, expect, it } from 'vitest';

import { decidePlacesOf, shownInOf, turnedMessageOf } from './routing';

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

// Where an opened question shows (decide.html): Bridge, and each place
// routing has on for Decide that the gateway offers, in routing's order.

describe('where an opened question shows', () => {
  it('names Bridge and the places on for Decide, as Where things show sets them', () => {
    expect(shownInOf(['slack', 'chat'])).toBe('Shows in Bridge, Slack and a chat, as Where things show sets for Decide. One answer, wherever you give it.');
  });

  it('names Bridge alone while no other place is on for Decide', () => {
    expect(shownInOf([])).toBe('Shows in Bridge, as Where things show sets for Decide. One answer, wherever you give it.');
  });

  it('names web push and email in the words a sentence reads', () => {
    expect(shownInOf(['slack', 'chat', 'web-push', 'email'])).toBe('Shows in Bridge, Slack, a chat, web push and email, as Where things show sets for Decide. One answer, wherever you give it.');
  });

  it('takes the places on for Decide that the gateway offers, leaving out one it does not offer', () => {
    const routing = {
      offered: { slack: true, chat: true, 'web-push': true, email: false },
      jobs: [
        { job: 'decide' as const, places: { slack: true, chat: false, 'web-push': true, email: true } },
        { job: 'do' as const, places: { slack: false, chat: true, 'web-push': false, email: false } },
      ],
    };

    expect(decidePlacesOf(routing)).toEqual(['slack', 'web-push']);
  });
});
