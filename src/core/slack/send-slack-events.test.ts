import type { DeliveryId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aKeptSlackEvent, aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackEvents, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import type { FleetRefusal } from '../connection/ports.js';
import type { PersonCrew } from '../people/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import { createSendSlackEvents } from './send-slack-events.js';

// The gateway sends each kept message as the person ship, which it crews,
// to the bot's ship, until core stores or refuses it (gateway scopes 9.4
// steps 5 to 7): the idempotency key from Slack's event id, so a send tried
// again is the same send. Core stored it: a reaction on the person's Slack
// message. Core refused it: the reason in the thread. Core did not answer:
// sent again next round. Nothing builds up: a taken event's id goes after
// an hour; an event core has not taken in 24 hours goes, the person told.

const NOW = new Date('2026-10-27T09:00:00.000Z');
const RELEASE_NOTES: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9r1n';
const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';

/** The fleet's send as the person ship's crew: one message per idempotency key, unless it does not answer or refuses. */
function fakeSender() {
  const noRefusal = (): FleetRefusal | undefined => undefined;
  const state = { messages: new Map<string, { crewToken: string; to: ShipId; contentType: string; payload: string; inReplyTo?: MessageId }>(), calls: 0, refusal: noRefusal(), handled: new Array<DeliveryId>() };
  const sender = {
    handled: (_crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>> => {
      state.handled.push(deliveryId);
      return Promise.resolve(ok(undefined));
    },
    send: (crewToken: string, message: { to: ShipId; contentType: string; payload: string; idempotencyKey: string; inReplyTo?: MessageId }): Promise<Result<{ messageId: MessageId }, FleetRefusal>> => {
      state.calls += 1;
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      const { idempotencyKey, ...sent } = message;
      if (!state.messages.has(idempotencyKey)) {
        state.messages.set(idempotencyKey, { crewToken, ...sent });
      }
      return Promise.resolve(ok({ messageId: `msg_01m3tb1zgr5h2ffee12xnch${String(state.messages.size).padStart(3, '0')}` as const }));
    },
  };
  return { state, sender };
}

let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let events: ReturnType<typeof memorySlackEvents>;
let slack: ReturnType<typeof fakeSlackMessages>;
let fleet: ReturnType<typeof fakeSender>;
let crews: Map<string, PersonCrew>;
let posts: ReturnType<typeof memorySlackPosts>;

beforeEach(async () => {
  apps = memorySlackApps();
  links = memorySlackLinks();
  events = memorySlackEvents();
  slack = fakeSlackMessages();
  fleet = fakeSender();
  posts = memorySlackPosts();
  crews = new Map([[MATHILDE_SHIP, { fleetId: FLEET_ID, shipId: MATHILDE_SHIP, crewToken: 'crew-mathilde', crewedAt: NOW }]]);
  await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: { token: 'xoxb-2', userId: 'U0BOT' } }));
  await links.add(aSlackLink());
  await events.keep(aKeptSlackEvent({ receivedAt: NOW }));
});

function sendRound(now = NOW) {
  return createSendSlackEvents({
    events,
    apps,
    crews: { find: (_fleetId, shipId) => Promise.resolve(crews.get(shipId)) },
    sender: fleet.sender,
    door: fleet.sender,
    posts,
    slack: slack.messages,
    clock: { now: () => now },
  })();
}

describe("a linked person's message from Slack into the fleet", () => {
  it('is sent as the person ship to the bot\'s ship, as Markdown, keyed by the event id, and its Slack message reacted to', async () => {
    await sendRound();

    expect([...fleet.state.messages.entries()]).toEqual([['slack:Ev01', { crewToken: 'crew-mathilde', to: RELEASE_NOTES, contentType: 'text/markdown', payload: 'when is the release?' }]]);
    expect(slack.state.reactions).toEqual([{ botToken: 'xoxb-2', channel: 'D0MATHILDE', ts: '1730019600.000100', name: 'white_check_mark' }]);
    expect(events.held[0]).toMatchObject({ eventId: 'Ev01', takenAt: NOW, markdown: '' });
  });

  it("keeps the person's message as it is in Slack, so the ship's reply goes into that conversation", async () => {
    await sendRound();

    expect(posts.held).toEqual([{ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tb1zgr5h2ffee12xnch001', deliveryId: null, senderShipId: null, appId: 'A02', channel: 'D0MATHILDE', ts: '1730019600.000100', threadTs: null, isLinkOnly: false, ackedAt: null }]);
  });

  it('sends an answer in the thread under a posted delivery in reply to its message, then hands the delivery', async () => {
    await events.remove(FLEET_ID, 'Ev01');
    await events.keep(aKeptSlackEvent({ eventId: 'Ev02', inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', receivedAt: NOW }));

    await sendRound();

    expect(fleet.state.messages.get('slack:Ev02')?.inReplyTo).toBe('msg_01m3tbfspe96yf1rnr4ank0002');
    expect(fleet.state.handled).toEqual(['dlv_01m3tbfspe96yf1rnr4ank0002']);
  });

  it('is sent again next round while core does not answer, giving exactly one message', async () => {
    fleet.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };
    await sendRound();
    const whileDown = { reactions: slack.state.reactions.length, takenAt: events.held[0]?.takenAt };

    fleet.state.refusal = undefined;
    await sendRound(new Date('2026-10-27T09:00:05.000Z'));
    await sendRound(new Date('2026-10-27T09:00:10.000Z'));

    expect(whileDown).toEqual({ reactions: 0, takenAt: null });
    expect({ messages: fleet.state.messages.size, calls: fleet.state.calls, reactions: slack.state.reactions.length }).toEqual({ messages: 1, calls: 2, reactions: 1 });
  });

  it("is sent again next round while Slack does not take the reaction, giving exactly one message and one reaction", async () => {
    slack.state.refusal = { kind: 'unavailable', message: 'Slack did not answer' };
    await sendRound();
    const whileSlackDown = { reactions: slack.state.reactions.length, takenAt: events.held[0]?.takenAt };

    slack.state.refusal = undefined;
    await sendRound(new Date('2026-10-27T09:00:05.000Z'));
    await sendRound(new Date('2026-10-27T09:00:10.000Z'));

    expect(whileSlackDown).toEqual({ reactions: 0, takenAt: null });
    expect({ messages: fleet.state.messages.size, reactions: slack.state.reactions.length, takenAt: events.held[0]?.takenAt }).toEqual({ messages: 1, reactions: 1, takenAt: new Date('2026-10-27T09:00:05.000Z') });
  });

  it("tells core's refusal in the thread next round while Slack does not take the post, the message dropped only once told", async () => {
    fleet.state.refusal = { code: 'NOT_REACHABLE', message: 'No rule lets you reach this ship' };
    slack.state.refusal = { kind: 'rateLimited', retryAfterSeconds: 1 };
    await sendRound();
    const whileSlackDown = { told: slack.state.inThread.length, takenAt: events.held[0]?.takenAt };

    slack.state.refusal = undefined;
    await sendRound(new Date('2026-10-27T09:00:05.000Z'));
    await sendRound(new Date('2026-10-27T09:00:10.000Z'));

    expect(whileSlackDown).toEqual({ told: 0, takenAt: null });
    expect({ told: slack.state.inThread.map(({ text }) => text), takenAt: events.held[0]?.takenAt }).toEqual({ told: ['You may not message release-notes'], takenAt: new Date('2026-10-27T09:00:05.000Z') });
  });

  it('answers in the thread that the person may not message the ship when no rule lets them', async () => {
    fleet.state.refusal = { code: 'NOT_REACHABLE', message: 'No rule lets you reach this ship' };

    await sendRound();

    expect(slack.state.inThread).toEqual([{ botToken: 'xoxb-2', channel: 'D0MATHILDE', threadTs: '1730019600.000100', text: 'You may not message release-notes' }]);
    expect({ reactions: slack.state.reactions, takenAt: events.held[0]?.takenAt }).toEqual({ reactions: [], takenAt: NOW });
  });

  it('answers in the thread that the ship was retired', async () => {
    fleet.state.refusal = { code: 'UNRESOLVABLE_SELECTOR', message: 'release-notes is retired: a retired ship is never addressed again' };

    await sendRound();

    expect(slack.state.inThread.map(({ text }) => text)).toEqual(['release-notes was retired']);
  });

  it("answers any other refusal with core's reason, plainly, in the thread the message is in", async () => {
    await events.remove(FLEET_ID, 'Ev01');
    await events.keep(aKeptSlackEvent({ eventId: 'Ev02', ts: '1730019700.000200', threadTs: '1730019600.000100', receivedAt: NOW }));
    fleet.state.refusal = { code: 'PAYLOAD_TOO_LARGE', message: 'The payload is over 64 KB' };

    await sendRound();

    expect(slack.state.inThread.map(({ threadTs, text }) => ({ threadTs, text }))).toEqual([{ threadTs: '1730019600.000100', text: 'release-notes did not take your message: The payload is over 64 KB' }]);
  });

  it('waits while the gateway holds no crew for the person ship', async () => {
    crews.clear();

    await sendRound();

    expect({ calls: fleet.state.calls, takenAt: events.held[0]?.takenAt }).toEqual({ calls: 0, takenAt: null });
  });

  it("forgets a taken event's id an hour after core took it, at the boundary kept", async () => {
    await sendRound();

    await sendRound(new Date('2026-10-27T10:00:00.000Z'));
    const atTheHour = events.held.length;
    await sendRound(new Date('2026-10-27T10:00:00.001Z'));

    expect([atTheHour, events.held.length]).toEqual([1, 0]);
  });

  it('deletes an event core has not taken in 24 hours, telling the person in the thread', async () => {
    fleet.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await sendRound(new Date('2026-10-28T09:00:00.000Z'));
    const atTheDay = events.held.length;
    await sendRound(new Date('2026-10-28T09:00:00.001Z'));

    expect([atTheDay, events.held.length]).toEqual([1, 0]);
    expect(slack.state.inThread.map(({ text }) => text)).toEqual(['This message did not reach the fleet; send it again']);
  });
});
