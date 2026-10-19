import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aClientCall, MESSAGE_ID, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { aPushedDelivery, fakeProxyShipCrew } from '../../../test/support/mcp-out-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { McpClientParty } from '../parties/party.js';
import type { Clock } from '../shared/clock.js';
import { createCollectReplies } from './collect-replies.js';

const CLAUDE: McpClientParty = {
  fleetId: FLEET_ID,
  name: 'claude',
  kind: 'mcpClient',
  clientId: 'https://claude.example.com/client.json',
  ownerShipId: OWNER_SHIP_ID,
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
const REPLY = aPushedDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r01', messageId: 'msg_01m3tbfspe96yf1rnr4ank9r01', contentType: 'text/plain', payload: 'Two deals.', inReplyTo: MESSAGE_ID });

let crew: ReturnType<typeof fakeProxyShipCrew>;
let calls: ReturnType<typeof memoryClientCalls>;
let stop: AbortController;
let rounds: number;

/** Each sleep ends a round; the run stops after a few. */
const sleep: Sleep = async () => {
  rounds += 1;
  await new Promise((resolve) => setImmediate(resolve));
  if (rounds >= 3) {
    stop.abort();
  }
};

beforeEach(async () => {
  crew = fakeProxyShipCrew();
  calls = memoryClientCalls();
  await calls.save(aClientCall());
  stop = new AbortController();
  rounds = 0;
});

const collect = () => createCollectReplies({ crew, calls, clock, sleep, pollMs: 2000 })({ party: CLAUDE, signal: stop.signal });

describe("the gateway takes the replies to an outside client's calls, as its proxy ship's crew (Q9 a)", () => {
  it('keeps a reply on the call it names, then acknowledges and handles its delivery', async () => {
    crew.state.waiting = [REPLY];

    await collect();

    expect((await calls.findByMessage(FLEET_ID, MESSAGE_ID))?.replies).toEqual([
      { deliveryId: REPLY.deliveryId, messageId: REPLY.messageId, contentType: 'text/plain', payload: 'Two deals.', receivedAt: NOW },
    ]);
    expect(crew.log).toEqual([
      ['ack', REPLY.deliveryId],
      ['handled', REPLY.deliveryId],
    ]);
    expect(crew.crewTokens.every((token) => token === 'aeolus_ct_v1_claude')).toBe(true);
  });

  it.each([
    { what: 'a message that replies to nothing', delivery: aPushedDelivery({ inReplyTo: null }) },
    { what: 'a reply to a message no call sent', delivery: aPushedDelivery({ inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank9m99' }) },
  ])('leaves $what unacknowledged, for the inbox of a later slice', async ({ delivery }) => {
    crew.state.waiting = [delivery];

    await collect();

    expect(crew.log).toEqual([]);
  });

  it('acknowledges nothing it could not keep', async () => {
    crew.state.waiting = [REPLY];
    calls.isFailing = true;

    await collect().catch(() => undefined);

    expect(crew.log).toEqual([]);
  });

  it('keeps a reply once, though the fleet hands it again after a lost acknowledgement', async () => {
    crew.state.waiting = [REPLY];
    crew.state.isAckLost = true;

    await collect();

    expect((await calls.findByMessage(FLEET_ID, MESSAGE_ID))?.replies).toHaveLength(1);
  });

  it('ends once the fleet refuses the crew token', async () => {
    crew.state.receiveRefusal = { code: 'LEASE_ENDED', message: 'The lease ended' };

    await expect(collect()).resolves.toEqual({ ended: 'crewRefused' });
  });
});
