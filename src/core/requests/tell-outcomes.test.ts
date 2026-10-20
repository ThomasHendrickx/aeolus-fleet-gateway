import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { OWNER_SHIP_ID } from '../../../test/support/party-fakes.js';
import { memoryPendingRequests } from '../../../test/support/request-fakes.js';
import type { CallSender } from '../mcp-in/ports.js';
import { err, ok } from '../shared/result.js';
import type { OutcomeNotice } from './ports.js';
import { createTellOutcomes } from './tell-outcomes.js';

// The gateway's ship tells a person the outcome of their request for an
// outside MCP server, as a message to their person ship (decision 0056,
// P5-2 a). No outcome is lost: one the fleet did not store is told again,
// under the same key, so it is stored once (P5-3 a).

const LINEAR = 'https://mcp.linear.app/mcp';
const DENIED: OutcomeNotice = { fleetId: FLEET_ID, requestId: 'req_1', accountId: 'acc-charlotte', personShipId: OWNER_SHIP_ID, url: LINEAR, outcome: 'denied', partyName: null };

let requests: ReturnType<typeof memoryPendingRequests>;
let connections: ReturnType<typeof memoryConnectionStore>;
let sent: { crewToken: string; to: ShipId; contentType: string; payload: string; idempotencyKey: string }[];
let answer: 'stored' | 'unavailable' | 'refused';

beforeEach(async () => {
  requests = memoryPendingRequests();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-20T09:00:00.000Z') });
  sent = [];
  answer = 'stored';
});

const sender: CallSender = {
  send: (crewToken, message) => {
    sent.push({ crewToken, ...message });
    if (answer === 'unavailable') {
      return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
    }
    return Promise.resolve(answer === 'refused' ? err({ code: 'FORBIDDEN', message: 'Your ship may not reach this ship' }) : ok({ messageId: 'msg_01m5cgv0000000000000000001' }));
  },
};

function tellOutcomes(...notices: OutcomeNotice[]) {
  requests.notices.push(...notices.map((notice) => ({ ...notice, isEnded: false })));
  return createTellOutcomes({ notices: requests.outcomeNotices, requests, connections, sender })();
}

describe("telling a person their request's outcome", () => {
  it("sends it as the gateway's ship to their person ship, as text, under a key of the request and the account, and the account is told", async () => {
    await tellOutcomes(DENIED);

    expect({ sent, notices: requests.notices.map(({ isEnded }) => isEnded), told: [...requests.told] }).toEqual({
      sent: [{ crewToken: 'aeolus_ct_v1_gateway', to: OWNER_SHIP_ID, contentType: 'text/plain', payload: `Your request for ${LINEAR} was denied.`, idempotencyKey: 'req_1:acc-charlotte' }],
      notices: [true],
      told: ['req_1 acc-charlotte'],
    });
  });

  it.each([
    { what: 'approval', outcome: { outcome: 'approved' as const, partyName: 'linear' }, text: `Your request for ${LINEAR} was approved: it is the outside party linear.` },
    { what: 'expiry', outcome: { outcome: 'expired' as const, partyName: null }, text: `Your request for ${LINEAR} expired after 7 days with no decision: ask again to try anew.` },
  ])('says the $what', async ({ outcome, text }) => {
    await tellOutcomes({ ...DENIED, ...outcome });

    expect(sent.map(({ payload }) => payload)).toEqual([text]);
  });

  it('keeps an outcome the fleet did not answer, to tell it again under the same key', async () => {
    answer = 'unavailable';
    await tellOutcomes(DENIED);
    answer = 'stored';

    await createTellOutcomes({ notices: requests.outcomeNotices, requests, connections, sender })();

    expect({ keys: sent.map(({ idempotencyKey }) => idempotencyKey), isEnded: requests.notices.map(({ isEnded }) => isEnded) }).toEqual({ keys: ['req_1:acc-charlotte', 'req_1:acc-charlotte'], isEnded: [true] });
  });

  it("ends an outcome the fleet refused, the account still to be told on the gateway's page", async () => {
    answer = 'refused';

    await tellOutcomes(DENIED);

    expect({ isEnded: requests.notices.map(({ isEnded }) => isEnded), told: [...requests.told] }).toEqual({ isEnded: [true], told: [] });
  });

  it('keeps the outcomes of a fleet the gateway is not connected to', async () => {
    await tellOutcomes({ ...DENIED, fleetId: OTHER_FLEET_ID });

    expect({ sent, isEnded: requests.notices.map(({ isEnded }) => isEnded) }).toEqual({ sent: [], isEnded: [false] });
  });
});
