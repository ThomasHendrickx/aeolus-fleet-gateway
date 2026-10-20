import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeClientMetadataDocuments, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { fakeWaitingSeals, memoryPendingRequests } from '../../../test/support/request-fakes.js';
import { createReadAuthorization } from '../oauth/read-authorization.js';
import type { McpClientParty } from '../parties/party.js';
import type { PendingRequest } from './ports.js';
import { createReadWaiting } from './read-waiting.js';

// The browser that asked for an outside MCP client waits on the gateway's
// page, which goes on by itself once the request is decided (decision 0056):
// approved, the client gets its party's code; denied or expired, it gets
// access_denied, and the account was told.

const ASKED_AT = new Date('2026-10-20T09:00:00.000Z');
const CLIENT_ID = 'https://orderbot.example.com/client.json';
const CALLBACK = 'https://orderbot.example.com/callback';
const REQUEST = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: CALLBACK, code_challenge: 'S256(verifier-1)', code_challenge_method: 'S256', resource: RESOURCE, state: 'state-1' };
const PENDING: PendingRequest = {
  fleetId: FLEET_ID,
  requestId: 'req_1',
  subject: { kind: 'client', clientId: CLIENT_ID, clientName: 'Orderbot' },
  requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
  askedAt: ASKED_AT,
  expiresAt: new Date('2026-10-27T09:00:00.000Z'),
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
};
const PARTY: McpClientParty = {
  fleetId: FLEET_ID,
  name: 'orderbot',
  kind: 'mcpClient',
  clientId: CLIENT_ID,
  ownerShipId: OWNER_SHIP_ID,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_orderbot',
  requestId: 'req_1',
  requestHash: 'h',
  approvedAt: ASKED_AT,
};
const DENIED = `${CALLBACK}?error=access_denied&state=state-1&iss=${encodeURIComponent(ISSUER)}`;

let now: Date;
let requests: ReturnType<typeof memoryPendingRequests>;
let parties: ReturnType<typeof memoryPartyStore>;
let codes: ReturnType<typeof memoryAuthorizationCodes>;
let waitings: ReturnType<typeof fakeWaitingSeals>;

beforeEach(() => {
  now = new Date('2026-10-21T09:00:00.000Z');
  requests = memoryPendingRequests();
  requests.held.push(PENDING);
  parties = memoryPartyStore();
  codes = memoryAuthorizationCodes();
  waitings = fakeWaitingSeals();
  waitings.seal({ fleetId: FLEET_ID, requestId: 'req_1', accountId: 'acc-charlotte', browserSecret: 'browser-1', request: REQUEST });
});

function readWaiting(documents = fakeClientMetadataDocuments({ [CLIENT_ID]: { client_id: CLIENT_ID, client_name: 'Orderbot', redirect_uris: [CALLBACK] } })) {
  return createReadWaiting({
    waitings,
    readAuthorization: createReadAuthorization({ clients: memoryOAuthClients(), documents, resource: RESOURCE }),
    requests,
    parties,
    codes,
    secrets: fakeSecrets(),
    clock: { now: () => now },
    issuer: ISSUER,
  });
}

function decided(state: 'approved' | 'denied') {
  requests.held.splice(0, 1, { ...PENDING, state, decidedBy: { kind: 'operator' }, decidedAt: now });
}

describe('the browser waits for an outside MCP client to be approved', () => {
  it('waits while the request is pending', async () => {
    await expect(readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({ isOk: true, value: { kind: 'waiting', clientName: 'Orderbot' } });
  });

  it("sends the client back with a code for its party once approved and crewed, bound to the client's request", async () => {
    decided('approved');
    await parties.save(PARTY);

    await expect(readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({
      isOk: true,
      value: { kind: 'answered', redirectTo: `${CALLBACK}?code=secret-1&state=state-1&iss=${encodeURIComponent(ISSUER)}` },
    });
    expect(codes.held.get('hash(secret-1)')).toMatchObject({ fleetId: FLEET_ID, clientId: CLIENT_ID, redirectUri: CALLBACK, codeChallenge: 'S256(verifier-1)', kind: 'party', party: 'orderbot' });
  });

  it('waits while an approved party awaits crew', async () => {
    decided('approved');
    await parties.save({ ...PARTY, state: 'awaitingCrew', crewToken: null });

    await expect(readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({ isOk: true, value: { kind: 'waiting', clientName: 'Orderbot' } });
  });

  it('sends the client back with access_denied once denied, the account told', async () => {
    decided('denied');

    await expect(readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({ isOk: true, value: { kind: 'answered', redirectTo: DENIED } });
    expect([...requests.told]).toEqual(['req_1 acc-charlotte']);
  });

  it('sends the client back with access_denied once the request expired, and not a moment before', async () => {
    now = new Date('2026-10-27T08:59:59.999Z');
    const before = await readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' });
    now = new Date('2026-10-27T09:00:00.000Z');

    await expect(readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({ isOk: true, value: { kind: 'answered', redirectTo: DENIED } });
    expect(before).toEqual({ isOk: true, value: { kind: 'waiting', clientName: 'Orderbot' } });
  });

  it('refuses a waiting it did not seal, or one whose request is forgotten', async () => {
    const unsealed = await readWaiting()({ waiting: 'waiting-9', browserSecret: 'browser-1' });
    requests.held.splice(0, 1);

    await expect(readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({ isOk: false, error: { kind: 'unknownWaiting' } });
    expect(unsealed).toEqual({ isOk: false, error: { kind: 'unknownWaiting' } });
  });

  it('refuses another browser than the one that asked, issuing nothing', async () => {
    decided('approved');
    await parties.save(PARTY);

    await expect(readWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-2' })).resolves.toEqual({ isOk: false, error: { kind: 'otherBrowser' } });
    expect(codes.held.size).toBe(0);
  });

  it("reads the client's request again, so a client that changed is refused as /authorize refuses it", async () => {
    await expect(readWaiting(fakeClientMetadataDocuments())({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
  });
});
