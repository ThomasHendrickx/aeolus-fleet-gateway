import { describe, expect, it } from 'vitest';

import { sendLabelOf, sentTextOf, standingTextOf, type BasketItem } from './basket';

// The basket's words (Bridge, section 9; the basket mockup): what each entry
// stands as, what Send sends, and what it did.

function anItem(standing: BasketItem['standing']): BasketItem {
  return { questionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e', deliveryId: 'dlv_01', from: 'commercial', title: 'Pricing page: a price per ship, or plans only?', sentAt: '2026-10-31T19:13:00.000Z', option: 1, optionLabel: 'Plans only', note: null, standing };
}

describe("the basket's words", () => {
  it('names how many answers Send sends', () => {
    expect([sendLabelOf(1), sendLabelOf(3)]).toEqual(['Send 1 answer', 'Send 3 answers']);
  });

  it('says what each entry not waiting stands as, and nothing for one waiting', () => {
    expect([
      standingTextOf(anItem({ kind: 'waiting' })),
      standingTextOf(anItem({ kind: 'sending' })),
      standingTextOf(anItem({ kind: 'refused', reason: 'commercial did not take the answer: Ship commercial was retired' })),
      standingTextOf(anItem({ kind: 'withdrawn', at: '2026-10-31T20:09:00.000Z' })),
      standingTextOf(anItem({ kind: 'replaced', replacementId: 'dlv_02', at: '2026-10-31T20:11:00.000Z', replacementTitle: 'Pricing page: plans only?' })),
      standingTextOf(anItem({ kind: 'dealtElsewhere', place: 'slack', option: 2 })),
      standingTextOf(anItem({ kind: 'dealtElsewhere', place: 'chat', option: null })),
    ]).toEqual([
      undefined,
      'Sending... The gateway keeps sending what is stored as sending, with the same key, until it is stored; you can close Bridge.',
      'Not sent: commercial did not take the answer: Ship commercial was retired. The others were sent.',
      'Withdrawn by commercial. Not sent; Send skips it.',
      'Replaced by commercial. Not sent: its options may differ, so answer the new question.',
      'Answered in Slack: option 2. Nothing is sent from it.',
      'Done in a chat. Nothing is sent from it.',
    ]);
  });

  it('says what Send did: the answers being sent, and each entry it skipped', () => {
    expect([
      sentTextOf({ sending: 3, skipped: [] }),
      sentTextOf({ sending: 1, skipped: [{ questionId: 'q1', title: 'Hold PR #1488?', kind: 'withdrawn' }, { questionId: 'q2', title: 'Pricing page?', kind: 'replaced' }] }),
      sentTextOf({ sending: 0, skipped: [{ questionId: 'q3', title: 'Hold PR #1488?', kind: 'dealtElsewhere' }] }),
    ]).toEqual([
      '3 answers are being sent, each on its own, in the order you added them.',
      '1 answer is being sent. Not sent: “Hold PR #1488?”, withdrawn; “Pricing page?”, replaced.',
      'Nothing to send. Not sent: “Hold PR #1488?”, answered elsewhere.',
    ]);
  });
});
