import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { memoryPendingRequests } from '../../../test/support/request-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createApproveClientParty, createApproveParty } from '../parties/approve-party.js';
import { createDecideRequest } from './decide-request.js';
import { createListToDecide } from './list-to-decide.js';
import type { PendingRequest } from './ports.js';

// An actor holding gateway:approve decides a pending request (decision
// 0056): approving names the proxy ship's owner, a person ship, and its
// scopes, only scopes the approver holds, and the gateway, as its own ship,
// commissions and crews the proxy ship; the first decision counts.

const ASKED_AT = new Date('2026-10-20T09:00:00.000Z');
const APPROVER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9apr';
const APPROVER_ACTOR: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: APPROVER, scopes: ['gateway:approve', 'fleet:read'] };
const READER_ACTOR: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: APPROVER, scopes: ['fleet:read', 'fleet:manage'] };
const CHARLOTTE = { accountId: 'acc-charlotte', personShipId: OWNER_SHIP_ID };

function aRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    fleetId: FLEET_ID,
    requestId: 'req_01m5c7hmbt9f1vrkwb37az0001',
    subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
    requesters: [CHARLOTTE],
    askedAt: ASKED_AT,
    expiresAt: new Date('2026-10-27T09:00:00.000Z'),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

const SERVER_REQUEST = aRequest({ requestId: 'req_01m5c7hmbt9f1vrkwb37az0002', subject: { kind: 'server', url: 'https://mcp.linear.app/mcp' } });
const APPROVE = { kind: 'approve' as const, party: { name: 'orderbot', ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'messages:receive', 'fleet:read'] } };

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let requests: ReturnType<typeof memoryPendingRequests>;
let now: Date;

beforeEach(async () => {
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  requests = memoryPendingRequests();
  requests.held.push(aRequest(), SERVER_REQUEST);
  now = new Date('2026-10-21T09:00:00.000Z');
});

async function decideRequest() {
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: ASKED_AT });
  const approval = { connections, parties, door: fleet.door, hasher: plainHasher, clock: { now: () => now } };
  return createDecideRequest({ requests, approveParty: createApproveParty(approval), approveClientParty: createApproveClientParty(approval), clock: { now: () => now } });
}

const decide = async (input: Parameters<Awaited<ReturnType<typeof decideRequest>>>[0]) => (await decideRequest())(input);
const CLIENT_ID = aRequest().requestId;

describe('an approver approves a pending request for an outside MCP client', () => {
  it("commissions the client's proxy ship as the gateway's ship, owned by the person ship named, with the scopes granted, under the request as its key", async () => {
    await decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: APPROVE });

    expect(fleet.state.commissioned).toEqual([{ name: 'orderbot', type: 'mcp-client', owner: OWNER_SHIP_ID, idempotencyKey: CLIENT_ID, scopes: ['fleet:read'] }]);
  });

  it('answers approved with the crewed party, and keeps who decided and when', async () => {
    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: APPROVE })).resolves.toMatchObject({
      isOk: true,
      value: { state: 'approved', party: { name: 'orderbot', kind: 'mcpClient', state: 'crewed', proxyShipId: PROXY_SHIP_ID } },
    });
    await expect(requests.find(FLEET_ID, CLIENT_ID)).resolves.toMatchObject({ state: 'approved', decidedBy: { kind: 'ship', shipId: APPROVER }, decidedAt: now });
  });
});

describe('an approver approves a person\'s request for an outside MCP server', () => {
  it('adds the server at the address asked for, with the credential and concurrency the approver gives', async () => {
    const approved = await decide({
      actor: APPROVER_ACTOR,
      requestId: SERVER_REQUEST.requestId,
      decision: { kind: 'approve', party: { name: 'linear', ownerShipId: OWNER_SHIP_ID, scopes: [] }, server: { credential: { kind: 'bearer', token: 'lin-token' }, concurrencyLimit: 4 } },
    });

    expect(approved).toMatchObject({ isOk: true, value: { state: 'approved', party: { name: 'linear', kind: 'mcpServer', url: 'https://mcp.linear.app/mcp', state: 'crewed' } } });
    await expect(parties.find(FLEET_ID, 'linear')).resolves.toMatchObject({ credential: { kind: 'bearer', token: 'lin-token' } });
  });

  it('refuses it without the credential and concurrency, deciding nothing', async () => {
    await expect(decide({ actor: APPROVER_ACTOR, requestId: SERVER_REQUEST.requestId, decision: { ...APPROVE, party: { ...APPROVE.party, name: 'linear' } } })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SERVER_DETAILS_MISSING' },
    });
    await expect(requests.find(FLEET_ID, SERVER_REQUEST.requestId)).resolves.toMatchObject({ state: 'pending' });
  });
});

describe('deciding a pending request', () => {
  it('denies it, commissioning nothing', async () => {
    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: { kind: 'deny' } })).resolves.toEqual({ isOk: true, value: { state: 'denied', party: null } });
    expect({ commissioned: fleet.state.commissioned, request: (await requests.find(FLEET_ID, CLIENT_ID))?.state }).toEqual({ commissioned: [], request: 'denied' });
  });

  it('refuses an actor without gateway:approve, deciding nothing', async () => {
    await expect(decide({ actor: READER_ACTOR, requestId: CLIENT_ID, decision: APPROVE })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('refuses a scope the approver does not hold, commissioning nothing; messages:send and messages:receive every app ship gets', async () => {
    const decision = { kind: 'approve' as const, party: { ...APPROVE.party, scopes: ['messages:send', 'fleet:commission'] } };

    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision })).resolves.toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD', message: expect.stringContaining('fleet:commission') as unknown } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it("keeps the request pending, undecided, when the fleet refuses a scope the gateway's ship does not hold", async () => {
    const actor: Actor = { ...APPROVER_ACTOR, scopes: ['gateway:approve', 'labels:any'] };

    await expect(decide({ actor, requestId: CLIENT_ID, decision: { kind: 'approve', party: { ...APPROVE.party, scopes: ['labels:any'] } } })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'COMMISSION_REFUSED' },
    });
    await expect(requests.find(FLEET_ID, CLIENT_ID)).resolves.toMatchObject({ state: 'pending', decidedBy: null });
  });

  it('counts the first decision: a later one is refused, saying the outcome, and commissions nothing', async () => {
    await decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: { kind: 'deny' } });

    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: APPROVE })).resolves.toMatchObject({ isOk: false, error: { kind: 'ALREADY_DECIDED', message: expect.stringContaining('denied') as unknown } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('refuses a request at 7 days, as expired, and decides one just before', async () => {
    now = new Date('2026-10-27T09:00:00.000Z');
    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: { kind: 'deny' } })).resolves.toMatchObject({ isOk: false, error: { kind: 'EXPIRED' } });

    now = new Date('2026-10-27T08:59:59.999Z');
    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: { kind: 'deny' } })).resolves.toMatchObject({ isOk: true });
  });

  it("refuses a request it does not know, or another fleet's", async () => {
    requests.held.push(aRequest({ fleetId: OTHER_FLEET_ID, requestId: 'req_01m5c7hmbt9f1vrkwb37az0009' }));

    await expect(
      Promise.all([decide({ actor: APPROVER_ACTOR, requestId: 'req_01m5c7hmbt9f1vrkwb37az0404', decision: { kind: 'deny' } }), decide({ actor: APPROVER_ACTOR, requestId: 'req_01m5c7hmbt9f1vrkwb37az0009', decision: { kind: 'deny' } })]),
    ).resolves.toMatchObject([
      { isOk: false, error: { kind: 'NO_SUCH_REQUEST' } },
      { isOk: false, error: { kind: 'NO_SUCH_REQUEST' } },
    ]);
  });

  it('picks the approval up again after the fleet did not answer, commissioning one ship', async () => {
    fleet.state.isLosingNextAnswer = true;
    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: APPROVE })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });

    await expect(decide({ actor: APPROVER_ACTOR, requestId: CLIENT_ID, decision: APPROVE })).resolves.toMatchObject({ isOk: true, value: { state: 'approved' } });
    expect(fleet.state.commissioned).toHaveLength(1);
  });
});

describe('the requests to decide', () => {
  it('lists every open request of the fleet for an approver, leaving out expired and decided ones', async () => {
    requests.held.push(aRequest({ requestId: 'req_01m5c7hmbt9f1vrkwb37az0003', expiresAt: now }), aRequest({ requestId: 'req_01m5c7hmbt9f1vrkwb37az0004', state: 'denied' }));

    const listed = await createListToDecide({ requests, clock: { now: () => now } })(APPROVER_ACTOR);

    expect(listed.isOk ? listed.value.map((request) => request.requestId) : listed).toEqual([CLIENT_ID, SERVER_REQUEST.requestId]);
  });

  it('refuses an actor without gateway:approve', async () => {
    await expect(createListToDecide({ requests, clock: { now: () => now } })(READER_ACTOR)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
  });
});
