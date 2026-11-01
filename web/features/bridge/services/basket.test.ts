import { describe, expect, it } from 'vitest';

import { answerTextOf, entryLinesOf, footOf, isStruckOut, sendLabelOf, sentSummaryOf, type BasketItem, type BasketView } from './basket';

// The basket's words (Bridge, section 9; basket.html, basket-3 to basket-7):
// each entry's answer by number and label, the line under it as it stands,
// the foot naming the ships or saying how the send goes, and what was sent.

const HARBOUR: BasketItem = {
  questionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
  deliveryId: 'dlv_01',
  from: 'orchestrator-1',
  title: 'Which goes first: the Compact look (U4) or Harbour?',
  sentAt: '2026-10-31T19:41:00.000Z',
  option: 2,
  optionLabel: "Harbour first, on today's look",
  note: 'Harbour first: the demo on 12 Nov needs it. U4 restyles after.',
  standing: { kind: 'waiting' },
};
const PRICING: BasketItem = { ...HARBOUR, questionId: 'q-pricing', deliveryId: 'dlv_02', from: 'commercial', title: 'Pricing page: a price per ship, or plans only?', sentAt: '2026-10-31T19:13:00.000Z', option: 1, optionLabel: 'Plans only', note: null };
const RETENTION: BasketItem = { ...HARBOUR, questionId: 'q-retention', deliveryId: 'dlv_03', from: 'builder-core', title: 'Record retention for person ships: 90 days or 1 year?', sentAt: '2026-10-31T19:28:00.000Z', option: 1, optionLabel: '90 days, the fleet default', note: 'A year only when a customer asks for it.' };
const REVIEW: BasketItem = { ...HARBOUR, questionId: 'q-review', deliveryId: 'dlv_04', from: 'reviewer', title: 'Hold PR #1488 until its restart test is in?', sentAt: '2026-10-31T19:23:00.000Z', option: 1, optionLabel: 'Yes, hold it', note: null };

const SENT = { kind: 'sent', at: '2026-10-31T20:16:00.000Z' } as const;
const SENDING = { kind: 'sending', isUnanswered: false } as const;
const UNANSWERED = { kind: 'sending', isUnanswered: true } as const;
const REFUSED = { kind: 'refused', reason: 'commercial was retired, so it cannot receive an answer' } as const;
const WITHDRAWN = { kind: 'withdrawn', at: '2026-10-31T20:09:00.000Z' } as const;

function aView(entries: BasketItem[], counts: { count: number; toSend: number }): BasketView {
  return { ...counts, entries };
}

describe('an entry of the basket', () => {
  it('names the answer by its number and label, a note alone as such, and an option kept without its label by its number', () => {
    expect([answerTextOf(HARBOUR), answerTextOf({ ...HARBOUR, option: null, optionLabel: null }), answerTextOf({ ...HARBOUR, optionLabel: null })]).toEqual(["2. Harbour first, on today's look", 'Note alone', 'Option 2']);
  });

  it('strikes out a withdrawn, a replaced and an answered-elsewhere entry, and no other', () => {
    expect([WITHDRAWN, { kind: 'replaced', replacementId: 'dlv_09', at: '2026-10-31T20:11:00.000Z', replacementTitle: null } as const, { kind: 'dealtElsewhere', place: 'slack', option: 2 } as const, { kind: 'waiting' } as const, SENDING, SENT, REFUSED].map(isStruckOut)).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('the line under each entry', () => {
  it('says nothing under an entry waiting for Send (basket-3)', () => {
    expect(entryLinesOf(aView([HARBOUR, PRICING], { count: 2, toSend: 2 }))).toEqual([undefined, undefined]);
  });

  it('says when its asker withdrew it, and when and with what new question it replaced it (basket-4)', () => {
    const lines = entryLinesOf(
      aView([{ ...REVIEW, standing: WITHDRAWN }, { ...PRICING, standing: { kind: 'replaced', replacementId: 'dlv_09', at: '2026-10-31T20:11:00.000Z', replacementTitle: 'Pricing page: plans only, or plans with a per-ship add-on?' } }], { count: 0, toSend: 0 }),
    );

    expect(lines).toEqual([
      { icon: 'withdrawn', tone: 'off', words: { desktop: 'Withdrawn by reviewer at 20:09 UTC. Not sent; Send skips it.', phone: 'Withdrawn by reviewer. Not sent.' } },
      { icon: 'replaced', tone: 'off', words: { desktop: 'Replaced by commercial at 20:11 UTC with "Pricing page: plans only, or plans with a per-ship add-on?" Not sent: its options differ, so answer the new one.', phone: 'Replaced by commercial. Not sent.' } },
    ]);
  });

  it('says a replacement whose title is not known by when alone', () => {
    const [line] = entryLinesOf(aView([{ ...PRICING, standing: { kind: 'replaced', replacementId: null, at: '2026-10-31T20:11:00.000Z', replacementTitle: null } }], { count: 0, toSend: 0 }));

    expect(line?.words.desktop).toBe('Replaced by commercial at 20:11 UTC. Not sent: its options differ, so answer the new one.');
  });

  it('says one sent with when, the one being sent, and the next in the order added (basket-5)', () => {
    const lines = entryLinesOf(aView([{ ...HARBOUR, standing: SENT }, { ...PRICING, standing: SENDING }, { ...RETENTION, standing: SENDING }], { count: 3, toSend: 0 }));

    expect(lines).toEqual([
      { icon: 'sent', tone: 'ok', words: { desktop: 'Sent at 20:16 UTC and stored. Done.', phone: 'Sent at 20:16 UTC. Done.' } },
      { icon: 'sending', tone: 'waiting', words: { desktop: 'Sending...', phone: 'Sending...' } },
      { icon: 'next', tone: 'waiting', words: { desktop: 'Next, in the order you added it', phone: 'Next' } },
    ]);
  });

  it('says one the fleet did not answer is sent again with the same key, and one refused in words, the others sent (basket-7)', () => {
    const lines = entryLinesOf(aView([{ ...HARBOUR, standing: SENT }, { ...RETENTION, standing: UNANSWERED }, { ...PRICING, standing: REFUSED }], { count: 2, toSend: 0 }));

    expect(lines.slice(1)).toEqual([
      { icon: 'unanswered', tone: 'waiting', words: { desktop: 'The fleet did not answer. Sending again with the same key until it is stored; it arrives once.', phone: 'No answer from the fleet. Sending again, same key.' } },
      { icon: 'refused', tone: 'attention', words: { desktop: 'Not sent: commercial was retired, so it cannot receive an answer. The others were sent.', phone: 'Not sent: commercial was retired, so it cannot receive an answer.' } },
    ]);
  });

  it('says the one after one not answered is the one being sent', () => {
    const lines = entryLinesOf(aView([{ ...RETENTION, standing: UNANSWERED }, { ...PRICING, standing: SENDING }], { count: 2, toSend: 0 }));

    expect(lines.map((line) => line?.icon)).toEqual(['unanswered', 'sending']);
  });

  it('leaves out "The others were sent" while none was', () => {
    const [line] = entryLinesOf(aView([{ ...PRICING, standing: REFUSED }], { count: 0, toSend: 0 }));

    expect(line?.words.desktop).toBe('Not sent: commercial was retired, so it cannot receive an answer.');
  });

  it('says an entry answered elsewhere first where and with what, nothing sent from it', () => {
    const lines = entryLinesOf(aView([{ ...HARBOUR, standing: { kind: 'dealtElsewhere', place: 'slack', option: 2 } }, { ...PRICING, standing: { kind: 'dealtElsewhere', place: 'chat', option: null } }], { count: 0, toSend: 0 }));

    expect(lines.map((line) => line?.words.desktop)).toEqual(['Answered in Slack: option 2. Nothing is sent from it.', 'Done in a chat. Nothing is sent from it.']);
  });
});

describe("the basket's foot", () => {
  it('names the ships that each receive their own answer, and Send N answers (basket-3)', () => {
    expect(footOf(aView([HARBOUR, PRICING, RETENTION], { count: 3, toSend: 3 }))).toEqual({
      kind: 'send',
      words: { desktop: 'orchestrator-1, commercial and builder-core each receive their own answer, as you, as if sent one by one.', phone: 'Each asker receives its own answer.' },
      label: 'Send 3 answers',
    });
  });

  it('names one ship receiving its answer', () => {
    expect(footOf(aView([HARBOUR], { count: 1, toSend: 1 }))).toMatchObject({ words: { desktop: 'orchestrator-1 receives its own answer, as you, as if sent one by one.' }, label: 'Send 1 answer' });
  });

  it('names each ship once, however many answers it receives', () => {
    expect(footOf(aView([HARBOUR, { ...PRICING, from: 'orchestrator-1' }], { count: 2, toSend: 2 }))).toMatchObject({ words: { desktop: 'orchestrator-1 receives its own answer to each, as you, as if sent one by one.' } });
  });

  it('says how many it sends and that the withdrawn and the replaced one are not sent (basket-4)', () => {
    const view = aView([HARBOUR, { ...REVIEW, standing: WITHDRAWN }, { ...PRICING, standing: { kind: 'replaced', replacementId: 'dlv_09', at: '2026-10-31T20:11:00.000Z', replacementTitle: null } }, RETENTION], { count: 2, toSend: 2 });

    expect(footOf(view)).toEqual({ kind: 'send', words: { desktop: '2 to send. The withdrawn and the replaced one are not sent.', phone: 'The withdrawn and the replaced one are not sent.' }, label: 'Send 2 answers' });
  });

  it('says each kind not sent by how many, the one answered elsewhere as such', () => {
    const view = aView([HARBOUR, { ...REVIEW, standing: WITHDRAWN }, { ...PRICING, standing: WITHDRAWN }, { ...RETENTION, standing: { kind: 'dealtElsewhere', place: 'slack', option: 1 } }], { count: 1, toSend: 1 });

    expect(footOf(view)).toMatchObject({ words: { desktop: '1 to send. The 2 withdrawn and the one answered elsewhere are not sent.' } });
  });

  it('says a single withdrawn one is not sent', () => {
    expect(footOf(aView([HARBOUR, { ...REVIEW, standing: WITHDRAWN }], { count: 1, toSend: 1 }))).toMatchObject({ words: { desktop: '1 to send. The withdrawn one is not sent.' } });
  });

  it('says Bridge can be closed and Sending N of M while the send goes on (basket-5)', () => {
    expect(footOf(aView([{ ...HARBOUR, standing: SENT }, { ...PRICING, standing: SENDING }, { ...RETENTION, standing: SENDING }], { count: 3, toSend: 0 }))).toEqual({
      kind: 'sending',
      words: { desktop: 'You can close Bridge: the gateway keeps sending what is stored as sending.', phone: 'You can close Bridge; the gateway keeps sending.' },
      progress: 'Sending 2 of 3',
    });
  });

  it('says Sending 1 of 1 for a single answer', () => {
    expect(footOf(aView([{ ...HARBOUR, standing: SENDING }], { count: 1, toSend: 0 }))).toMatchObject({ progress: 'Sending 1 of 1' });
  });

  it('sums up what was sent, what is still sending and what was not, once one failed (basket-7)', () => {
    expect(footOf(aView([{ ...HARBOUR, standing: SENT }, { ...RETENTION, standing: UNANSWERED }, { ...PRICING, standing: REFUSED }], { count: 2, toSend: 0 }))).toEqual({
      kind: 'summary',
      words: { desktop: '1 sent, 1 still sending, 1 not sent.', phone: '1 sent, 1 sending, 1 not sent.' },
    });
  });

  it('leaves out of the summary what none is', () => {
    expect(footOf(aView([{ ...HARBOUR, standing: SENT }, { ...PRICING, standing: REFUSED }], { count: 0, toSend: 0 }))).toMatchObject({ words: { desktop: '1 sent, 1 not sent.' } });
  });

  it('has no foot once every entry was sent, nor in an empty basket', () => {
    expect([footOf(aView([{ ...HARBOUR, standing: SENT }], { count: 0, toSend: 0 })), footOf(aView([], { count: 0, toSend: 0 }))]).toEqual([{ kind: 'none' }, { kind: 'none' }]);
  });
});

describe('what was sent', () => {
  it('sums up the answers sent once every entry left was sent, naming the ships (basket-6)', () => {
    expect(sentSummaryOf(aView([{ ...HARBOUR, standing: SENT }, { ...PRICING, standing: SENT }, { ...RETENTION, standing: SENT }], { count: 0, toSend: 0 }))).toEqual({ title: '3 answers sent', description: 'To orchestrator-1, commercial and builder-core, as you; each stored, each in Done.' });
  });

  it('says one answer sent', () => {
    expect(sentSummaryOf(aView([{ ...HARBOUR, standing: SENT }], { count: 0, toSend: 0 }))).toEqual({ title: '1 answer sent', description: 'To orchestrator-1, as you; stored, and in Done.' });
  });

  it('sums up nothing while any entry is not sent, or none was', () => {
    expect([sentSummaryOf(aView([{ ...HARBOUR, standing: SENT }, { ...PRICING, standing: SENDING }], { count: 2, toSend: 0 })), sentSummaryOf(aView([], { count: 0, toSend: 0 }))]).toEqual([undefined, undefined]);
  });
});

describe('the Send button', () => {
  it('names how many answers it sends', () => {
    expect([sendLabelOf(1), sendLabelOf(3)]).toEqual(['Send 1 answer', 'Send 3 answers']);
  });
});
