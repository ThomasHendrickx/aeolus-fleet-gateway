import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, fakePersonShipDoor } from '../../../test/support/people-fakes.js';
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
  payload: JSON.stringify({ id: '5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11', title: 'Cut travel?', context: 'Over by 10%', options: [{ key: 1, label: 'Cut', detail: '' }, { key: 2, label: 'Keep', detail: '' }], pick: { option: 1, why: 'over' } }),
});

let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let posts: ReturnType<typeof memorySlackPosts>;
let slack: ReturnType<typeof fakeSlackMessages>;
let fleet: ReturnType<typeof fakePersonShipDoor>;

beforeEach(async () => {
  apps = memorySlackApps();
  links = memorySlackLinks();
  posts = memorySlackPosts();
  slack = fakeSlackMessages();
  fleet = fakePersonShipDoor({ crewToken: 'crew-mathilde', deliveries: [QUESTION] });
  await fleet.door.ack('crew-mathilde', QUESTION.deliveryId);
  await apps.save(aSlackApp({ appId: 'A01', name: 'Acme', bot: { token: 'xoxb-1', userId: 'U01' } }));
  await links.add(aSlackLink());
  await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION.messageId, deliveryId: QUESTION.deliveryId, senderShipId: BUDGET_CHECK, appId: 'A01', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null, isLinkOnly: false, ackedAt: NOW });
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
    slack: slack.messages,
    signatures,
    clock: { now: () => NOW },
  })({ appId: 'A01', teamId: 'T0ACME', userId: sent.userId ?? 'U0MATHILDE', channel: 'D0MATHILDE', messageTs: '1730020000.000001', messageId: QUESTION.messageId, option, body, timestamp: NOW_SECONDS, signature: sent.signature ?? `signing-A01:${NOW_SECONDS}:${body}` });
}

describe("a press of a question's button in Slack", () => {
  it('sends the answer as the person ship in reply to the question, hands the delivery, and reacts to the question', async () => {
    const answered = await press(1);

    expect(answered).toEqual({ isOk: true, value: { kind: 'answered' } });
    expect(fleet.replies).toEqual([{ to: BUDGET_CHECK, inReplyTo: QUESTION.messageId, contentType: 'application/vnd.aeolus.answer+json', payload: '{"questionId":"5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11","option":1}', idempotencyKey: `answer-${QUESTION.deliveryId}` }]);
    expect(fleet.calls).toContain(`handled(${QUESTION.deliveryId})`);
    expect(slack.state.reactions).toEqual([{ botToken: 'xoxb-1', channel: 'D0MATHILDE', ts: '1730020000.000001', name: 'white_check_mark' }]);
  });

  it('answers a question pressed before Slack answered its post, acknowledging the delivery first', async () => {
    fleet = fakePersonShipDoor({ crewToken: 'crew-mathilde', deliveries: [QUESTION] });
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION.messageId, deliveryId: QUESTION.deliveryId, senderShipId: BUDGET_CHECK, appId: 'A01', channel: 'D0MATHILDE', ts: null, threadTs: null, isLinkOnly: false, ackedAt: null });

    const answered = await press(2);

    expect({ answered, replies: fleet.replies.map(({ inReplyTo, payload }) => ({ inReplyTo, payload })), isHandled: fleet.calls.includes(`handled(${QUESTION.deliveryId})`) }).toEqual({
      answered: { isOk: true, value: { kind: 'answered' } },
      replies: [{ inReplyTo: QUESTION.messageId, payload: '{"questionId":"5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11","option":2}' }],
      isHandled: true,
    });
  });

  it("says in the thread why core did not take the answer", async () => {
    fleet.refusals.reply.push({ code: 'NOT_REACHABLE', message: 'No rule' });

    await press(2);

    expect(slack.state.inThread.map(({ threadTs, text }) => ({ threadTs, text }))).toEqual([{ threadTs: '1730020000.000001', text: 'budget-check did not take your answer: No rule' }]);
  });

  it('refuses a press not signed with the app\'s signing secret, answering nothing', async () => {
    await expect(press(1, { signature: 'v0=forged' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
    expect(fleet.replies).toEqual([]);
  });

  it('answers nothing for a press naming a question posted in another conversation', async () => {
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: QUESTION.messageId, deliveryId: QUESTION.deliveryId, senderShipId: BUDGET_CHECK, appId: 'A01', channel: 'C0LAUNCH', ts: '1730020000.000001', threadTs: null, isLinkOnly: false, ackedAt: NOW });

    const answered = await press(1);

    expect({ answered, replies: fleet.replies }).toEqual({ answered: { isOk: true, value: { kind: 'ignored' } }, replies: [] });
  });

  it('answers nothing for a press by someone the question was not posted to', async () => {
    const answered = await press(1, { userId: 'U0JORIS' });

    expect({ answered, replies: fleet.replies }).toEqual({ answered: { isOk: true, value: { kind: 'ignored' } }, replies: [] });
  });
});
