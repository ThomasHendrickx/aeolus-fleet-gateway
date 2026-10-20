import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeSecrets, ISSUER, memoryAuthorizationCodes, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { fakeWaitingSeals, memoryPendingRequests } from '../../../test/support/request-fakes.js';
import type { AuthorizationRequest } from '../oauth/read-authorization.js';
import type { McpClientParty } from '../parties/party.js';
import { createAskForClient } from './ask-for-client.js';
import { createOpenRequest } from './open-request.js';

// A signed-in account of the fleet asks for access for an outside MCP client
// (decision 0056, Thomas's question A): the client's party answers at once
// when it has one; else the request waits for an approver. A deny or an
// expired request ends the account's next try with access_denied; a later
// try asks anew.

const ASKED_AT = new Date('2026-10-20T09:00:00.000Z');
const CLIENT_ID = 'https://orderbot.example.com/client.json';
const CALLBACK = 'https://orderbot.example.com/callback';
const CHARLOTTE = { accountId: 'acc-charlotte', personShipId: 'shp_01m3tb1zgr5h2ffee12xnch8pp' as const satisfies ShipId };
const PIETER = { accountId: 'acc-pieter', personShipId: null };
const REQUEST = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: CALLBACK, code_challenge: 'S256(verifier-1)', code_challenge_method: 'S256', resource: RESOURCE, state: 'state-1' };
const AUTHORIZATION: AuthorizationRequest = { clientId: CLIENT_ID, clientName: 'Orderbot', clientFleetId: null, redirectUri: CALLBACK, codeChallenge: 'S256(verifier-1)', resource: RESOURCE, scope: null, state: 'state-1' };

function aClientParty(state: McpClientParty['state']): McpClientParty {
  return {
    fleetId: FLEET_ID,
    name: 'orderbot',
    kind: 'mcpClient',
    clientId: CLIENT_ID,
    ownerShipId: OWNER_SHIP_ID,
    state,
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: state === 'crewed' ? 'aeolus_ct_v1_orderbot' : null,
    requestId: 'req_1',
    requestHash: 'h',
    approvedAt: ASKED_AT,
  };
}

let now: Date;
let requests: ReturnType<typeof memoryPendingRequests>;
let parties: ReturnType<typeof memoryPartyStore>;
let codes: ReturnType<typeof memoryAuthorizationCodes>;
let waitings: ReturnType<typeof fakeWaitingSeals>;
let isOn: boolean;
let ids: number;

beforeEach(() => {
  now = ASKED_AT;
  requests = memoryPendingRequests();
  parties = memoryPartyStore();
  codes = memoryAuthorizationCodes();
  waitings = fakeWaitingSeals();
  isOn = true;
  ids = 0;
});

function askForClient() {
  const clock = { now: () => now };
  return createAskForClient({
    parties,
    requests,
    openRequest: createOpenRequest({ requests, ids: { newRequestId: () => `req_${String((ids += 1))}` }, clock }),
    servesOutsideParties: () => Promise.resolve(isOn),
    waitings,
    codes,
    secrets: fakeSecrets(),
    clock,
    issuer: ISSUER,
  });
}

function asked(requester: typeof CHARLOTTE | typeof PIETER = CHARLOTTE) {
  return askForClient()({ fleetId: FLEET_ID, requester, authorization: AUTHORIZATION, request: REQUEST, browserSecret: 'browser-1' });
}

/** The request of the client, decided as an approver would. */
async function decided(outcome: 'approved' | 'denied') {
  await requests.decide(FLEET_ID, { requestId: 'req_1', from: ['pending'], decision: { outcome, decidedBy: { kind: 'operator' }, decidedAt: now }, notices: [] });
}

describe('an account asks for access for an outside MCP client', () => {
  it('opens a pending request for the client, the account its requester, and waits for it in the same browser', async () => {
    await expect(asked()).resolves.toEqual({ isOk: true, value: { kind: 'waiting', waiting: 'waiting-1' } });
    expect({ request: requests.held, waiting: waitings.held.get('waiting-1') }).toEqual({
      request: [
        {
          fleetId: FLEET_ID,
          requestId: 'req_1',
          subject: { kind: 'client', clientId: CLIENT_ID, clientName: 'Orderbot' },
          requesters: [CHARLOTTE],
          askedAt: ASKED_AT,
          expiresAt: new Date('2026-10-27T09:00:00.000Z'),
          state: 'pending',
          decidedBy: null,
          decidedAt: null,
        },
      ],
      waiting: { fleetId: FLEET_ID, requestId: 'req_1', accountId: 'acc-charlotte', browserSecret: 'browser-1', request: REQUEST },
    });
  });

  it('joins the request pending for the same client', async () => {
    await asked();

    await asked(PIETER);

    expect(requests.held.map(({ requestId, requesters }) => ({ requestId, requesters }))).toEqual([{ requestId: 'req_1', requesters: [CHARLOTTE, PIETER] }]);
  });

  it("answers at once with a code for the client's party, opening no request", async () => {
    await parties.save(aClientParty('crewed'));

    await expect(asked()).resolves.toEqual({ isOk: true, value: { kind: 'answered', redirectTo: `${CALLBACK}?code=secret-1&state=state-1&iss=${encodeURIComponent(ISSUER)}` } });
    expect({ code: codes.held.get('hash(secret-1)'), requests: requests.held }).toMatchObject({ code: { kind: 'party', party: 'orderbot' }, requests: [] });
  });

  it("keeps the query of the client's redirect URI, adding the code to it", async () => {
    await parties.save(aClientParty('crewed'));

    const answer = await askForClient()({ fleetId: FLEET_ID, requester: CHARLOTTE, authorization: { ...AUTHORIZATION, redirectUri: `${CALLBACK}?tenant=acme` }, request: REQUEST, browserSecret: 'browser-1' });

    expect(answer).toEqual({ isOk: true, value: { kind: 'answered', redirectTo: `${CALLBACK}?tenant=acme&code=secret-1&state=state-1&iss=${encodeURIComponent(ISSUER)}` } });
  });

  it('ends the next try after a deny with access_denied, once, and a later try asks anew', async () => {
    await asked();
    await decided('denied');

    const next = await asked();
    const later = await asked();

    expect({ next, later }).toEqual({
      next: { isOk: true, value: { kind: 'answered', redirectTo: `${CALLBACK}?error=access_denied&state=state-1&iss=${encodeURIComponent(ISSUER)}` } },
      later: { isOk: true, value: { kind: 'waiting', waiting: 'waiting-2' } },
    });
    expect(requests.held.map(({ requestId, state }) => ({ requestId, state }))).toEqual([
      { requestId: 'req_1', state: 'denied' },
      { requestId: 'req_2', state: 'pending' },
    ]);
  });

  it('ends the next try after the request expired with access_denied', async () => {
    await asked();
    now = new Date('2026-10-27T09:00:00.000Z');

    await expect(asked()).resolves.toEqual({ isOk: true, value: { kind: 'answered', redirectTo: `${CALLBACK}?error=access_denied&state=state-1&iss=${encodeURIComponent(ISSUER)}` } });
  });

  it('asks anew for an account that did not ask for the denied request', async () => {
    await asked();
    await decided('denied');

    await expect(asked(PIETER)).resolves.toEqual({ isOk: true, value: { kind: 'waiting', waiting: 'waiting-2' } });
  });

  it("is refused while the fleet's outside parties are off, opening no request (interop I-3)", async () => {
    isOn = false;

    await expect(asked()).resolves.toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
    expect(requests.held).toEqual([]);
  });
});
