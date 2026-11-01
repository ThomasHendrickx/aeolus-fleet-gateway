import type { DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { PersonDelivery } from '../people/ports.js';
import { SEEN, slackPostOf } from './slack-post-of.js';

// What a delivery shows as in Slack (gateway scopes 9.5 step 2): text and
// Markdown as text, Markdown turned into Slack's markup; a question as its
// title and context with one button per option; JSON as a code block.
// Another content type, or more than Slack shows in full, goes as a link to
// the gateway's pages. The gateway's own bot heads it with the sender's name.
// An item with no other button gets Seen (Bridge, section 6).

const DELIVERY_ID: DeliveryId = 'dlv_01m3tb1zgr5h2ffee12xnch8sv';
const OVERVIEW_URL = 'https://gateway.acme.test/bridge?fleet=flt_01m3tb1zgr5h2ffee12xnch8sv';

function aDelivery(overrides: Partial<PersonDelivery> = {}): PersonDelivery {
  return {
    deliveryId: DELIVERY_ID,
    messageId: 'msg_01m3tb1zgr5h2ffee12xnch8sv',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n',
    senderName: 'release-notes',
    contentType: 'text/plain',
    payload: 'Friday',
    headline: null,
    askedQuestionId: null,
    withdrawnQuestionId: null,
    stepId: null,
    withdrawnStepId: null,
    sentAt: new Date('2026-10-27T09:00:00.000Z'),
    inReplyTo: null,
    meetingId: null,
    ...overrides,
  };
}

const QUESTION = JSON.stringify({ id: '5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11', title: 'Ship the release?', context: 'Notes are ready', options: [{ key: 1, label: 'Ship', detail: '' }, { key: 2, label: 'Wait', detail: 'one day' }], pick: { option: 1, why: 'ready' } });

describe('a delivery as Slack shows it', () => {
  it('shows text as it is, and Markdown in Slack\'s markup', () => {
    expect([
      slackPostOf(aDelivery(), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }),
      slackPostOf(aDelivery({ contentType: 'text/markdown; charset=utf-8', payload: '**Friday**, see [notes](https://acme.test/n) ~~Thursday~~' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }),
    ]).toEqual([
      { kind: 'shown', text: 'Friday', buttons: [SEEN] },
      { kind: 'shown', text: '*Friday*, see <https://acme.test/n|notes> ~Thursday~', buttons: [SEEN] },
    ]);
  });

  it("escapes Slack's control characters in text", () => {
    expect(slackPostOf(aDelivery({ payload: 'a < b & c > d' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({ kind: 'shown', text: 'a &lt; b &amp; c &gt; d', buttons: [SEEN] });
  });

  it('shows a question as its title and context, with one button per option', () => {
    expect(slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.question+json', payload: QUESTION }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({
      kind: 'shown',
      text: '*Ship the release?*\nNotes are ready',
      buttons: [{ text: 'Ship', option: 1 }, { text: 'Wait', option: 2 }],
    });
  });

  it('shows JSON as a code block', () => {
    expect(slackPostOf(aDelivery({ contentType: 'application/json', payload: '{"on":true}' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({ kind: 'shown', text: '```{"on":true}```', buttons: [SEEN] });
  });

  it("heads what the gateway's own bot shows with the sender's name", () => {
    expect(slackPostOf(aDelivery(), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: true })).toEqual({ kind: 'shown', text: '*release-notes*\nFriday', buttons: [SEEN] });
  });

  it('links to the gateway for another content type', () => {
    expect(slackPostOf(aDelivery({ contentType: 'image/png', payload: 'abc' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({ kind: 'link', text: `release-notes sent you a message Slack does not show in full: <${OVERVIEW_URL}|open it in the gateway>`, buttons: [SEEN] });
  });

  it('gives an alert and a notice a Seen button, the one thing they ask', () => {
    const alert = slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.alert+json', payload: '{}' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false });
    const notice = slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.notice+json', payload: '{}' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false });

    expect([alert.buttons, notice.buttons]).toEqual([[SEEN], [SEEN]]);
  });

  it('gives a step no Seen button: seeing it does not do it', () => {
    expect(slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.step+json', payload: '{}' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }).buttons).toEqual([]);
  });

  it('gives a question shown as a link no Seen button: seeing it does not answer it', () => {
    const long = JSON.stringify({ ...JSON.parse(QUESTION), context: 'c'.repeat(3_000) });

    expect(slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.question+json', payload: long }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }).buttons).toEqual([]);
  });

  it('shows 40,000 characters in full, and links to the gateway for one more', () => {
    const shown = slackPostOf(aDelivery({ payload: 'a'.repeat(40_000) }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false });
    const linked = slackPostOf(aDelivery({ payload: 'a'.repeat(40_001) }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false });

    expect([shown.kind, linked.kind]).toEqual(['shown', 'link']);
  });

  it("links to the gateway for a question whose block is over Slack's 3,000 characters", () => {
    const long = JSON.stringify({ ...JSON.parse(QUESTION), context: 'c'.repeat(3_000) });

    expect(slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.question+json', payload: long }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }).kind).toBe('link');
  });
});
