import type { MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aCallReply, aClientCall, fakeReplyReceiver, MESSAGE_ID, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { fakeProxyShipCrew } from '../../../test/support/mcp-out-fakes.js';
import { PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { McpClientParty } from '../parties/party.js';
import type { Clock } from '../shared/clock.js';
import { createCollectReplies } from './collect-replies.js';

// The gateway takes the replies to an outside client's calls as the crew of
// the client's proxy ship (Q9 a), with receiveReply for each call it waits on
// (aeolus-fleet#953): it takes only replies, so a message that replies to no
// call waits in the fleet and never keeps a reply out. Its lease stays plain:
// it never pushReceives, for receiveReply hands nothing on a pushed lease.

const CLAUDE: McpClientParty = {
  fleetId: FLEET_ID,
  name: 'claude',
  kind: 'mcpClient',
  clientId: 'https://claude.example.com/client.json',
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_claude',
  requestId: 'r-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-19T10:00:00.000Z'),
};

const NOW = new Date('2026-10-19T12:01:00.000Z');
const clock: Clock = { now: () => NOW };
const REPLY = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r01', messageId: 'msg_01m3tbfspe96yf1rnr4ank9r01', contentType: 'text/plain', payload: 'Two deals.' } as const;

let crew: ReturnType<typeof fakeProxyShipCrew>;
let fleet: ReturnType<typeof fakeReplyReceiver>;
let calls: ReturnType<typeof memoryClientCalls>;
let stop: AbortController;
let sleeps: number;

/** Each sleep lets the fleet move on; the run stops after a few. */
const sleep: Sleep = async () => {
  sleeps += 1;
  await new Promise((resolve) => setImmediate(resolve));
  if (sleeps >= 6) {
    stop.abort();
  }
};

beforeEach(async () => {
  crew = fakeProxyShipCrew();
  fleet = fakeReplyReceiver();
  calls = memoryClientCalls();
  await calls.save(aClientCall());
  stop = new AbortController();
  sleeps = 0;
  const ack = crew.ack.bind(crew);
  crew.ack = async (crewToken, deliveryId) => {
    const acked = await ack(crewToken, deliveryId);
    if (acked.isOk) {
      fleet.acknowledged(deliveryId);
    }
    return acked;
  };
});

const collect = () => createCollectReplies({ crew, replies: fleet.receiver, calls, clock, sleep, pollMs: 2000 })({ party: CLAUDE, signal: stop.signal });

/** A call of the party's, sent under its own message. */
const aCallOf = (messageId: MessageId, overrides: Parameters<typeof aClientCall>[0] = {}) => aClientCall({ messageId, handle: `handle-${messageId}`, ...overrides });

describe("the gateway takes the replies to an outside client's calls with receiveReply (aeolus-fleet#953)", () => {
  it('keeps a reply on the call it waits on, then acknowledges and handles its delivery', async () => {
    fleet.state.replies.set(MESSAGE_ID, [REPLY]);

    await collect();

    expect((await calls.findByMessage(FLEET_ID, MESSAGE_ID))?.replies).toEqual([{ ...REPLY, receivedAt: NOW }]);
    expect(crew.log).toEqual([
      ['ack', REPLY.deliveryId],
      ['handled', REPLY.deliveryId],
    ]);
    expect(fleet.state.asked.every(({ crewToken }) => crewToken === 'aeolus_ct_v1_claude')).toBe(true);
  });

  it('asks only for the replies to calls it waits on: not a completed call, nor one past its deadline', async () => {
    await calls.save(aCallOf('msg_01m3tbfspe96yf1rnr4ank9m02', { deadlineAt: new Date('2026-10-19T12:00:30.000Z') }));
    await calls.save(aCallOf('msg_01m3tbfspe96yf1rnr4ank9m03'));
    await calls.addReply({ fleetId: FLEET_ID, messageId: 'msg_01m3tbfspe96yf1rnr4ank9m03' }, aCallReply({ contentType: 'text/plain' }));

    await collect();

    expect(new Set(fleet.state.asked.map(({ messageId }) => messageId))).toEqual(new Set([MESSAGE_ID]));
  });

  it('waits on a call with no deadline until its answer came', async () => {
    calls.held.splice(0, 1, aClientCall({ deadlineAt: null }));
    fleet.state.replies.set(MESSAGE_ID, [REPLY]);

    await collect();
    const asked = fleet.state.asked.length;
    await collect();

    expect({ isKept: (await calls.findByMessage(FLEET_ID, MESSAGE_ID))?.replies.length, askedAfterAnswer: fleet.state.asked.length - asked }).toEqual({ isKept: 1, askedAfterAnswer: 0 });
  });

  it('never takes deliveries with pushReceive, so its lease stays plain', async () => {
    await collect();

    expect(crew.received).toEqual([]);
  });

  it('waits on at most 10 calls at once', async () => {
    for (let index = 10; index < 22; index += 1) {
      await calls.save(aCallOf(`msg_01m3tbfspe96yf1rnr4ank9m${String(index)}`));
    }

    await collect();

    expect({ most: fleet.state.mostInFlight, asked: new Set(fleet.state.asked.map(({ messageId }) => messageId)).size }).toEqual({ most: 10, asked: 13 });
  });

  it('acknowledges nothing it could not keep', async () => {
    fleet.state.replies.set(MESSAGE_ID, [REPLY]);
    calls.isFailing = true;

    await collect().catch(() => undefined);

    expect(crew.log).toEqual([]);
  });

  it('keeps a reply once, though the fleet hands it again after a lost acknowledgement', async () => {
    fleet.state.replies.set(MESSAGE_ID, [REPLY]);
    crew.state.isAckLost = true;

    await collect();

    expect((await calls.findByMessage(FLEET_ID, MESSAGE_ID))?.replies).toHaveLength(1);
  });

  it('ends once the fleet refuses the crew token', async () => {
    fleet.state.refusal = { code: 'LEASE_ENDED', message: 'The lease ended' };

    await expect(collect()).resolves.toEqual({ ended: 'crewRefused' });
  });
});
