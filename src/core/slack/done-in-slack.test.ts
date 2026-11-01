import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, fakePersonShipDoor, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries } from '../../../test/support/people-fakes.js';
import { aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import { createDoneInSlack } from './done-in-slack.js';

// A step shows in Slack with Open on its link and Done (Bridge, section 9,
// #1514): a press of Done sends the step's outcome done as the person ship,
// in reply to the step, at once and without a note, then the delivery is
// handled. Slack signs the press as it signs an event.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const NOW_SECONDS = String(NOW.getTime() / 1000);
const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const ORCHESTRATOR: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9bdg';
const STEP_ID = '7d3e2a10-4b6c-4f1e-9a2b-3c4d5e6f7a80';
const STEP = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0002',
  senderShipId: ORCHESTRATOR,
  senderName: 'orchestrator-1',
  contentType: 'application/vnd.aeolus.step+json',
  payload: JSON.stringify({ id: STEP_ID, title: 'Create the repository', why: 'Only you can', link: 'https://github.com/new' }),
  headline: 'Create the repository',
  stepId: STEP_ID,
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
  fleet = fakePersonShipDoor({ crewToken: 'crew-mathilde', deliveries: [STEP] });
  await apps.save(aSlackApp({ appId: 'A01', name: 'Acme', bot: { token: 'xoxb-1', userId: 'U01' } }));
  await links.add(aSlackLink());
  await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: STEP.messageId, deliveryId: STEP.deliveryId, senderShipId: ORCHESTRATOR, appId: 'A01', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null });
});

const signatures = { isSigned: ({ secret, timestamp, body, signature }: { secret: string; timestamp: string; body: string; signature: string }) => signature === `${secret}:${timestamp}:${body}` };

function pressDone(sent: { signature?: string } = {}) {
  const body = 'payload=done';
  return createDoneInSlack({
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
  })({ appId: 'A01', teamId: 'T0ACME', userId: 'U0MATHILDE', channel: 'D0MATHILDE', messageTs: '1730020000.000001', messageId: STEP.messageId, body, timestamp: NOW_SECONDS, signature: sent.signature ?? `signing-A01:${NOW_SECONDS}:${body}` });
}

describe("a press of a step's Done in Slack", () => {
  it("acknowledges the step, sends its outcome done without a note in reply to it, keyed as Bridge's Done is, and hands it", async () => {
    const done = await pressDone();

    expect({ done, replies: fleet.replies, calls: fleet.calls.filter((call) => call.startsWith('ack(') || call.startsWith('handled(')) }).toEqual({
      done: { isOk: true, value: { kind: 'done' } },
      replies: [{ to: ORCHESTRATOR, inReplyTo: STEP.messageId, contentType: 'application/vnd.aeolus.step-outcome+json', payload: `{"stepId":"${STEP_ID}","outcome":"done"}`, idempotencyKey: `step-outcome-${STEP.deliveryId}` }],
      calls: [`ack(${STEP.deliveryId})`, `handled(${STEP.deliveryId})`],
    });
  });

  it("keeps it done in Slack, forgets it as opened and tells the person's pages, so Bridge shows where it was done and its post is edited", async () => {
    await opened.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: STEP.deliveryId, messageId: STEP.messageId, senderShipId: ORCHESTRATOR, from: 'orchestrator-1', title: 'Create the repository', contentType: STEP.contentType, askedQuestionId: null, withdrawnQuestionId: null, stepId: STEP_ID, withdrawnStepId: null, stepLink: null, sentAt: STEP.sentAt, openedAt: NOW, openedIn: null });

    await pressDone();

    expect({ outcomes: outcomes.held, opened: opened.held.size, told: changes.told }).toEqual({
      outcomes: [{ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: STEP.deliveryId, place: 'slack', kind: 'done', option: null, note: null, seen: null, at: NOW }],
      opened: 0,
      told: [{ fleetId: FLEET_ID, shipId: MATHILDE_SHIP }],
    });
  });

  it('sends nothing for a step done in Bridge first, saying so in its thread', async () => {
    await outcomes.save({ fleetId: FLEET_ID, shipId: MATHILDE_SHIP, deliveryId: STEP.deliveryId, place: 'bridge', kind: 'cannot', option: null, at: NOW });

    const done = await pressDone();

    expect({ done, replies: fleet.replies, thread: slack.state.inThread.map(({ text }) => text) }).toEqual({ done: { isOk: true, value: { kind: 'doneElsewhere' } }, replies: [], thread: ['Already marked cannot in Bridge. Nothing is sent.'] });
  });

  it("says in the step's thread that the fleet did not take the outcome, keeping it undone", async () => {
    fleet.refusals.reply.push({ code: 'FORBIDDEN', message: 'orchestrator-1 is out of reach' });

    const done = await pressDone();

    expect({ done, handled: fleet.calls.includes(`handled(${STEP.deliveryId})`), outcomes: outcomes.held, thread: slack.state.inThread.map(({ text }) => text) }).toEqual({
      done: { isOk: true, value: { kind: 'refused' } },
      handled: false,
      outcomes: [],
      thread: ['orchestrator-1 did not take your outcome: orchestrator-1 is out of reach'],
    });
  });

  it('keeps nothing while the fleet did not take handled, so a press again tries once more', async () => {
    fleet.refusals.handled.push({ code: 'FLEET_UNREACHABLE', message: 'The fleet did not answer' });

    await pressDone();

    expect(outcomes.held).toEqual([]);
  });

  it('ignores a press under a delivery that is no step', async () => {
    fleet = fakePersonShipDoor({ crewToken: 'crew-mathilde', deliveries: [{ ...STEP, contentType: 'text/plain', payload: 'hi', stepId: null }] });

    const done = await pressDone();

    expect({ done, replies: fleet.replies }).toEqual({ done: { isOk: true, value: { kind: 'ignored' } }, replies: [] });
  });

  it('refuses a press Slack did not sign', async () => {
    await expect(pressDone({ signature: 'forged' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
  });
});
