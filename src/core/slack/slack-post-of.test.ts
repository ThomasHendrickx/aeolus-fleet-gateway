import type { DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { PersonDelivery } from '../people/ports.js';
import { SEEN, slackPostOf } from './slack-post-of.js';

// What a delivery shows as in Slack (gateway scopes 9.5 step 2): text and
// Markdown as text, Markdown turned into Slack's markup; JSON as a code
// block. An item (a question, a step, an alert, a notice) as views.html
// draws it: headed by its asker and job, its title, then what it asks with.
// Another content type, or more than Slack shows in full, goes as a link to
// the gateway's pages. The gateway's own bot heads a message with the
// sender's name. An item with no other button gets Seen (Bridge, section 6).

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

const QUESTION = JSON.stringify({ id: '5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11', title: 'Ship the release?', context: 'Notes are **ready**', options: [{ key: 1, label: 'Ship', detail: '' }, { key: 2, label: 'Wait', detail: 'one day' }], pick: { option: 1, why: 'ready' } });

describe('a delivery as Slack shows it', () => {
  it('shows text as it is, and Markdown in Slack\'s markup', () => {
    expect([
      slackPostOf(aDelivery(), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }),
      slackPostOf(aDelivery({ contentType: 'text/markdown; charset=utf-8', payload: '**Friday**, see [notes](https://acme.test/n) ~~Thursday~~' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }),
    ]).toEqual([
      { kind: 'shown', text: 'Friday', item: null, buttons: [SEEN] },
      { kind: 'shown', text: '*Friday*, see <https://acme.test/n|notes> ~Thursday~', item: null, buttons: [SEEN] },
    ]);
  });

  it("escapes Slack's control characters in text", () => {
    expect(slackPostOf(aDelivery({ payload: 'a < b & c > d' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({ kind: 'shown', text: 'a &lt; b &amp; c &gt; d', item: null, buttons: [SEEN] });
  });

  it("shows a question headed by its asker and job, its pick's line and button filled, then Open in Bridge", () => {
    expect(slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.question+json', payload: QUESTION, headline: 'Ship the release?' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({
      kind: 'shown',
      text: 'Question from release-notes: Ship the release?',
      item: {
        asker: 'release-notes',
        heading: 'Question from release-notes · Decide',
        title: 'Ship the release?',
        body: 'Notes are *ready*',
        aside: 'release-notes picks 1: ready',
        footer: `<${OVERVIEW_URL}|Open in Bridge> · reply in the thread to add a note`,
        tone: 'asking',
      },
      buttons: [{ text: '1. Ship', option: 1, isPicked: true }, { text: '2. Wait', option: 2, isPicked: false }],
    });
  });

  it('shows an alert and a notice headed by their sender and job, with their headline and Seen', () => {
    const alert = slackPostOf(aDelivery({ senderName: 'watch', contentType: 'application/vnd.aeolus.alert+json', payload: '{}', headline: 'builder-gateway: no report change for 2 h' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false });
    const notice = slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.notice+json', payload: '{}', headline: 'Release 0.36.2 is out' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false });

    expect([alert, notice]).toEqual([
      {
        kind: 'shown',
        text: 'Alert from watch: builder-gateway: no report change for 2 h',
        item: { asker: 'watch', heading: 'Alert from watch · Stay aware', title: 'builder-gateway: no report change for 2 h', body: null, aside: null, footer: null, tone: 'aware' },
        buttons: [SEEN],
      },
      {
        kind: 'shown',
        text: 'Notice from release-notes: Release 0.36.2 is out',
        item: { asker: 'release-notes', heading: 'Notice from release-notes · Stay aware', title: 'Release 0.36.2 is out', body: null, aside: null, footer: null, tone: 'aware' },
        buttons: [SEEN],
      },
    ]);
  });

  it('shows a step headed by its asker and job, with its why, Open on its link, Done, then Open in Bridge', () => {
    const step = JSON.stringify({ id: '7d3e2a10-4b6c-4f1e-9a2b-3c4d5e6f7a80', title: 'Create the repository', why: 'Only you can make one', link: 'https://github.com/new' });

    expect(slackPostOf(aDelivery({ senderName: 'orchestrator-1', contentType: 'application/vnd.aeolus.step+json', payload: step, headline: 'Create the repository' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({
      kind: 'shown',
      text: 'Step from orchestrator-1: Create the repository',
      item: { asker: 'orchestrator-1', heading: 'Step from orchestrator-1 · Do', title: 'Create the repository', body: 'Only you can make one', aside: null, footer: `<${OVERVIEW_URL}|Open in Bridge>`, tone: 'asking' },
      buttons: [{ text: 'Open github.com', url: 'https://github.com/new' }, { text: 'Done', isDone: true }],
    });
  });

  it('shows the new step of a step replacement, and a step without a link with Done alone', () => {
    const replacement = JSON.stringify({ stepId: '7d3e2a10-4b6c-4f1e-9a2b-3c4d5e6f7a80', step: { id: '8e4f3b21-5c7d-4a2f-8b3c-4d5e6f7a8b91', title: 'Create it private', why: 'It holds keys' } });

    expect(slackPostOf(aDelivery({ contentType: 'application/vnd.aeolus.step-replacement+json', payload: replacement, headline: 'Create it private' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toMatchObject({
      item: { title: 'Create it private', body: 'It holds keys' },
      buttons: [{ text: 'Done', isDone: true }],
    });
  });

  it("escapes Slack's control characters in an item's heading and title", () => {
    expect(slackPostOf(aDelivery({ senderName: 'a<b', contentType: 'application/vnd.aeolus.notice+json', payload: '{}', headline: 'x & y' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }).item).toMatchObject({ heading: 'Notice from a&lt;b · Stay aware', title: 'x &amp; y' });
  });

  it('shows JSON as a code block', () => {
    expect(slackPostOf(aDelivery({ contentType: 'application/json', payload: '{"on":true}' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({ kind: 'shown', text: '```{"on":true}```', item: null, buttons: [SEEN] });
  });

  it("heads what the gateway's own bot shows with the sender's name", () => {
    expect(slackPostOf(aDelivery(), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: true })).toEqual({ kind: 'shown', text: '*release-notes*\nFriday', item: null, buttons: [SEEN] });
  });

  it('links to the gateway for another content type', () => {
    expect(slackPostOf(aDelivery({ contentType: 'image/png', payload: 'abc' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false })).toEqual({ kind: 'link', text: `release-notes sent you a message Slack does not show in full: <${OVERVIEW_URL}|open it in the gateway>`, item: null, buttons: [SEEN] });
  });

  it('links to the gateway for an alert, a notice or a step whose payload does not read, Seen only for the alert and the notice', () => {
    const shown = ['application/vnd.aeolus.alert+json', 'application/vnd.aeolus.notice+json', 'application/vnd.aeolus.step+json'].map((contentType) => slackPostOf(aDelivery({ contentType, payload: '{}' }), { bridgeUrl: OVERVIEW_URL, isHeadedBySender: false }));

    expect(shown.map(({ kind, buttons }) => ({ kind, buttons }))).toEqual([
      { kind: 'link', buttons: [SEEN] },
      { kind: 'link', buttons: [SEEN] },
      { kind: 'link', buttons: [] },
    ]);
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
