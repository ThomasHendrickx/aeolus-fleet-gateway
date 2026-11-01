import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, fakePersonShipDoor, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries } from '../../../test/support/people-fakes.js';
import { aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import { createAnswerInSlack } from './answer-in-slack.js';

// A question shows in Slack with one button per option (gateway scopes 9.5
// step 2): a press sends the answer as the person ship, in reply to the
// question, and the delivery is handled. Slack signs the press as it signs
// an event.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const NOW_SECONDS = String(NOW.getTime() / 1000);
const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const BUDGET_CHECK: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9bdg';
const QUESTION = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0002',
  senderShipId: BUDGET_CHECK,
  senderName: 'budget-check',
  headline: 'Cut travel?',
  payload: JSON.stringify({ id: '5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11', title: 'Cut travel?', context: 'Over by 10%', options: [{ key: 1, label: 'Cut', detail: '' }, { key: 2, label: 'Keep', detail: '' }], pick: { option: 1, why: 'over' } }),
});

let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let posts: ReturnType<typeof memorySlackPosts>;
let slack: ReturnType<typeof fakeSlackMessages>;
let fleet: ReturnType<typeof fakePersonShipDoor>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let changes: ReturnType<typeof memoryInboxChanges>;

beforeEach(async () => {
  apps = memorySlackApps();
  links = memorySlackLinks();
  posts = memorySlackPosts();
  slack = fakeSlackMessages();
  outcomes = memoryItemOutcomes();
  opened = memoryOpenedDeliveries();
  changes = memoryInboxChanges();
  fleet = fakePersonShipDoor({ crewToken: 'crew-mathilde', deliveries: [QUESTION] });
  await fleet.door.ack('crew-mathilde', QUESTION.deliveryId);
  await apps.save(aSlackApp({ appId: 'A01', name: 'Acme', bot: { token: 'xoxb-1', userId: 'U01' } }));
  await links.add(aSlackLink());
  await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION.messageId, deliveryId: QUESTION.deliveryId, senderShipId: BUDGET_CHECK, appId: 'A01', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null });
});

const signatures = { isSigned: ({ secret, timestamp, body, signature }: { secret: string; timestamp: string; body: string; signature: string }) => signature === `${secret}:${timestamp}:${body}` };

function press(option: number, sent: { signature?: string; userId?: string } = {}) {
  const body = `payload=${String(option)}`;
  return createAnswerInSlack({
    apps,
    links,
    posts,
    crews: { find: (_fleetId, shipId) => Promise.resolve(shipId === MATHILDE_SHIP ? { fleetId: FLEET_ID, shipId, crewToken: 'crew-mathilde', crewedAt: NOW } : undefined) },
    door: fleet.door,
    outcomes,
    opened,
    changes,
    slack: slack.messages,
    signatures,
    clock: { now: () => NOW },
    bridgeUrlOf: (fleetId) => `https://gateway.acme.test/bridge?fleet=${fleetId}`,
  })({ appId: 'A01', teamId: 'T0ACME', userId: sent.userId ?? 'U0MATHILDE', channel: 'D0MATHILDE', messageTs: '1730020000.000001', messageId: QUESTION.messageId, option, body, timestamp: NOW_SECONDS, signature: sent.signature ?? `signing-A01:${NOW_SECONDS}:${body}` });
}

describe("a press of a question's button in Slack", () => {
  it('sends the answer as the person ship in reply to the question and hands the delivery', async () => {
    const answered = await press(1);

    expect(answered).toEqual({ isOk: true, value: { kind: 'answered' } });
    expect(fleet.replies).toEqual([{ to: BUDGET_CHECK, inReplyTo: QUESTION.messageId, contentType: 'application/vnd.aeolus.answer+json', payload: '{"questionId":"5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11","option":1}', idempotencyKey: 'answer-5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11' }]);
    expect(fleet.calls).toContain(`handled(${QUESTION.deliveryId})`);
  });

  describe('the post, as the press goes (aeolus-fleet#1573)', () => {
    it('shows the option it sends and to whom before the answer goes, its buttons gone', async () => {
      const reply = fleet.door.reply.bind(fleet.door);
      let editsAsSent: typeof slack.state.edits = [];
      fleet.door.reply = (crewToken, message) => {
        editsAsSent = [...slack.state.edits];
        return reply(crewToken, message);
      };

      await press(2);

      expect(editsAsSent.map(({ botToken, channel, ts, message }) => ({ botToken, channel, ts, aside: message.item?.aside, tone: message.item?.tone, buttons: message.buttons }))).toEqual([
        { botToken: 'xoxb-1', channel: 'D0MATHILDE', ts: '1730020000.000001', aside: 'Sending *2. Keep* to budget-check…', tone: 'asking', buttons: [] },
      ]);
    });

    it('is edited to the answer once sent, as views.html draws it: what was answered, when and to whom, and where it shows, its buttons gone', async () => {
      await press(2);

      expect(slack.state.edits.at(-1)?.message).toEqual({
        text: 'Question from budget-check: Cut travel?',
        item: {
          asker: 'budget-check',
          heading: 'Question from budget-check · Decide',
          title: 'Cut travel?',
          body: '✅ You answered at <!date^1793091600^{time}|09:00 UTC>: *2. Keep*, sent to budget-check',
          aside: null,
          footer: 'Bridge and the chat show it answered in Slack · <https://gateway.acme.test/bridge?fleet=flt_01m3tb1zgr5h2ffee12xnch8sv|Open in Bridge>',
          tone: 'done',
        },
        buttons: [],
      });
    });

    it('says on the post that the answer was not sent and why, its buttons back to press again', async () => {
      fleet.refusals.reply.push({ code: 'NOT_REACHABLE', message: 'No rule' });

      const answered = await press(2);

      const post = slack.state.edits.at(-1)?.message;
      expect({ answered, thread: slack.state.inThread, body: post?.item?.body, aside: post?.item?.aside, tone: post?.item?.tone, buttons: post?.buttons }).toEqual({
        answered: { isOk: true, value: { kind: 'refused' } },
        thread: [],
        body: 'Over by 10%',
        aside: '⚠️ Not sent: No rule. Press an option to try again.',
        tone: 'asking',
        buttons: [{ text: '1. Cut', option: 1, isPicked: true }, { text: '2. Keep', option: 2, isPicked: false }],
      });
    });
  });

  it('keeps it answered in Slack with the option pressed, so Bridge says where it was answered (Bridge, CC4)', async () => {
    await press(2);

    expect(outcomes.held).toEqual([{ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: QUESTION.deliveryId, place: 'slack', kind: 'answered', option: 2, note: null, seen: null, at: NOW }]);
  });

  it("tells the person's pages their inbox changed, so an open Bridge page shows it answered in Slack without a reload", async () => {
    await press(2);

    expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: MATHILDE_SHIP }]);
  });

  it('forgets the question as opened, so a chat no longer lists it at its next aeolus_inbox', async () => {
    await opened.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: QUESTION.deliveryId, messageId: QUESTION.messageId, senderShipId: BUDGET_CHECK, from: 'budget-check', title: 'Cut travel?', contentType: QUESTION.contentType, askedQuestionId: '5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11', withdrawnQuestionId: null, stepId: null, withdrawnStepId: null, stepLink: null, openedIn: null, sentAt: QUESTION.sentAt, openedAt: NOW });

    await press(2);

    expect(opened.held.size).toBe(0);
  });

  it("sends nothing for a question answered in Bridge first, saying so in its thread: one answer per question", async () => {
    await outcomes.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: QUESTION.deliveryId, place: 'bridge', kind: 'answered', option: 2, at: NOW });

    const answered = await press(1);

    expect({ answered, replies: fleet.replies, thread: slack.state.inThread.map(({ threadTs, text }) => ({ threadTs, text })) }).toEqual({
      answered: { isOk: true, value: { kind: 'answeredElsewhere' } },
      replies: [],
      thread: [{ threadTs: '1730020000.000001', text: 'Already answered in Bridge: option 2. Nothing is sent.' }],
    });
  });

  it('keeps nothing while the fleet did not take handled', async () => {
    fleet.refusals.handled.push({ code: 'FLEET_UNREACHABLE', message: 'The fleet did not answer' });

    await press(2);

    expect(outcomes.held).toEqual([]);
  });

  it("says in the question's thread that the message is sealed and the key not reachable, answering nothing, when the fleet cannot unseal the question", async () => {
    fleet.refusals.delivery.push({ code: 'KEY_UNAVAILABLE', message: "The fleet's company key is not reachable: access denied" });

    const answered = await press(1);

    expect({ answered, replies: fleet.replies, thread: slack.state.inThread }).toEqual({
      answered: { isOk: true, value: { kind: 'refused' } },
      replies: [],
      thread: [{ botToken: 'xoxb-1', channel: 'D0MATHILDE', threadTs: '1730020000.000001', text: "The message is sealed and the fleet's company key is not reachable: try again later. Nothing is lost; it waits." }],
    });
  });

  it('answers a question pressed before Slack answered its post, acknowledging the delivery first', async () => {
    fleet = fakePersonShipDoor({ crewToken: 'crew-mathilde', deliveries: [QUESTION] });
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION.messageId, deliveryId: QUESTION.deliveryId, senderShipId: BUDGET_CHECK, appId: 'A01', channel: 'D0MATHILDE', ts: null, threadTs: null });

    const answered = await press(2);

    expect({ answered, replies: fleet.replies.map(({ inReplyTo, payload }) => ({ inReplyTo, payload })), isHandled: fleet.calls.includes(`handled(${QUESTION.deliveryId})`) }).toEqual({
      answered: { isOk: true, value: { kind: 'answered' } },
      replies: [{ inReplyTo: QUESTION.messageId, payload: '{"questionId":"5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11","option":2}' }],
      isHandled: true,
    });
  });

  it("answers a press in the person's direct messages on a question kept by their user id, before Slack named the conversation (aeolus-fleet#1573)", async () => {
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION.messageId, deliveryId: QUESTION.deliveryId, senderShipId: BUDGET_CHECK, appId: 'A01', channel: 'U0MATHILDE', ts: null, threadTs: null });

    const answered = await press(2);

    expect({ answered, replies: fleet.replies.map(({ payload }) => payload) }).toEqual({ answered: { isOk: true, value: { kind: 'answered' } }, replies: ['{"questionId":"5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11","option":2}'] });
  });

  it('refuses a press not signed with the app\'s signing secret, answering nothing', async () => {
    await expect(press(1, { signature: 'v0=forged' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
    expect(fleet.replies).toEqual([]);
  });

  it('answers nothing for a press naming a question posted in another conversation', async () => {
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION.messageId, deliveryId: QUESTION.deliveryId, senderShipId: BUDGET_CHECK, appId: 'A01', channel: 'C0LAUNCH', ts: '1730020000.000001', threadTs: null });

    const answered = await press(1);

    expect({ answered, replies: fleet.replies }).toEqual({ answered: { isOk: true, value: { kind: 'ignored' } }, replies: [] });
  });

  it('answers nothing for a press by someone the question was not posted to', async () => {
    const answered = await press(1, { userId: 'U0JORIS' });

    expect({ answered, replies: fleet.replies }).toEqual({ answered: { isOk: true, value: { kind: 'ignored' } }, replies: [] });
  });
});
