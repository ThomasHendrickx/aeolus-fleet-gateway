import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, fakePersonShipDoor, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries } from '../../../test/support/people-fakes.js';
import { aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import { createSeeInSlack } from './see-in-slack.js';

// Slack's Seen button, under an item with no other (Bridge, section 6): a
// press is the person's first action, so the delivery is acknowledged;
// seeing an alert or a notice is all it asks, so it is handled too (CC16).

const NOW = new Date('2026-10-31T19:58:00.000Z');
const NOW_SECONDS = String(NOW.getTime() / 1000);
const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const WATCH: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9wch';
const ALERT = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0005',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0005',
  senderShipId: WATCH,
  senderName: 'watch',
  contentType: 'application/vnd.aeolus.alert+json',
  payload: '{}',
});
const MESSAGE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006', messageId: 'msg_01m3tbfspe96yf1rnr4ank0006', senderShipId: WATCH, senderName: 'watch', contentType: 'text/plain', payload: 'Friday' });

let posts: ReturnType<typeof memorySlackPosts>;
let fleet: ReturnType<typeof fakePersonShipDoor>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let changes: ReturnType<typeof memoryInboxChanges>;
let seeInSlack: ReturnType<typeof createSeeInSlack>;

beforeEach(async () => {
  const apps = memorySlackApps();
  const links = memorySlackLinks();
  posts = memorySlackPosts();
  outcomes = memoryItemOutcomes();
  opened = memoryOpenedDeliveries();
  changes = memoryInboxChanges();
  fleet = fakePersonShipDoor({ crewToken: 'crew-mathilde', deliveries: [ALERT, MESSAGE] });
  await apps.save(aSlackApp({ appId: 'A01', bot: { token: 'xoxb-1', userId: 'U01' } }));
  await links.add(aSlackLink());
  for (const delivery of [ALERT, MESSAGE]) {
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: delivery.messageId, deliveryId: delivery.deliveryId, senderShipId: WATCH, appId: 'A01', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null });
  }
  seeInSlack = createSeeInSlack({
    apps,
    links,
    posts,
    crews: { find: (_fleetId, shipId) => Promise.resolve(shipId === MATHILDE_SHIP ? { fleetId: FLEET_ID, shipId, crewToken: 'crew-mathilde', crewedAt: NOW } : undefined) },
    door: fleet.door,
    outcomes,
    opened,
    changes,
    slack: fakeSlackMessages().messages,
    signatures: { isSigned: ({ secret, timestamp, body, signature }) => signature === `${secret}:${timestamp}:${body}` },
    clock: { now: () => NOW },
  });
});

function press(delivery: { messageId: typeof ALERT.messageId }, sent: { signature?: string; userId?: string } = {}) {
  const body = 'payload=seen';
  return seeInSlack({ appId: 'A01', teamId: 'T0ACME', userId: sent.userId ?? 'U0MATHILDE', channel: 'D0MATHILDE', messageTs: '1730020000.000001', messageId: delivery.messageId, body, timestamp: NOW_SECONDS, signature: sent.signature ?? `signing-A01:${NOW_SECONDS}:${body}` });
}

describe("a press of Slack's Seen button", () => {
  it('acknowledges an alert and reports it handled: seeing it is all it asks (CC16)', async () => {
    const seen = await press(ALERT);

    expect({ seen, calls: fleet.calls.filter((call) => call.startsWith('ack') || call.startsWith('handled')) }).toEqual({ seen: { isOk: true, value: { kind: 'seen' } }, calls: [`ack(${ALERT.deliveryId})`, `handled(${ALERT.deliveryId})`] });
  });

  it('keeps it seen in Slack, so Bridge and the post say where it was seen', async () => {
    await press(ALERT);

    expect(outcomes.held).toEqual([{ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: ALERT.deliveryId, place: 'slack', kind: 'seen', option: null, at: NOW }]);
  });

  it("tells the person's pages their inbox changed, and forgets the alert as opened", async () => {
    await opened.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: ALERT.deliveryId, messageId: ALERT.messageId, senderShipId: WATCH, from: 'watch', title: 'charlotte is silent', contentType: ALERT.contentType, askedQuestionId: null, withdrawnQuestionId: null, stepId: null, withdrawnStepId: null, stepLink: null, sentAt: ALERT.sentAt, openedAt: NOW });

    await press(ALERT);

    expect({ told: changes.told, opened: opened.held.size }).toEqual({ told: [{ fleetId: FLEET_ID, shipId: MATHILDE_SHIP }], opened: 0 });
  });

  it('acknowledges any other message without reporting it handled, as opening it does, and keeps it seen in Slack', async () => {
    await press(MESSAGE);

    expect({ calls: fleet.calls.filter((call) => call.startsWith('ack') || call.startsWith('handled')), outcomes: outcomes.held.map(({ place, kind }) => ({ place, kind })) }).toEqual({ calls: [`ack(${MESSAGE.deliveryId})`], outcomes: [{ place: 'slack', kind: 'seen' }] });
  });

  it('keeps nothing while the fleet did not take handled for an alert, so a press again tries once more', async () => {
    fleet.refusals.handled.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });

    await press(ALERT);

    expect(outcomes.held).toEqual([]);
  });

  it('refuses a press not signed with the app\'s signing secret, acknowledging nothing', async () => {
    await expect(press(ALERT, { signature: 'v0=forged' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
    expect(fleet.calls).toEqual([]);
  });

  it('acknowledges nothing for a press by someone it was not posted to', async () => {
    const seen = await press(ALERT, { userId: 'U0JORIS' });

    expect({ seen, calls: fleet.calls }).toEqual({ seen: { isOk: true, value: { kind: 'ignored' } }, calls: [] });
  });
});
