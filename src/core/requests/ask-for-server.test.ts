import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { CHARLOTTE_GRANT } from '../../../test/support/people-fakes.js';
import { memoryPendingRequests } from '../../../test/support/request-fakes.js';
import { memoryAccountGrants, PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createAskForServer } from './ask-for-server.js';
import { createOpenRequest } from './open-request.js';

// A signed-in person asks for an outside MCP server from their chat
// (decision 0056): an approver of the fleet adds it, giving its credential.
// A second person asking for the same server joins the request pending.

const ASKED_AT = new Date('2026-10-20T09:00:00.000Z');
const LINEAR = 'https://mcp.linear.app/mcp';

let requests: ReturnType<typeof memoryPendingRequests>;
let parties: ReturnType<typeof memoryPartyStore>;
let grants: ReturnType<typeof memoryAccountGrants>;
let isOn: boolean;

beforeEach(async () => {
  requests = memoryPendingRequests();
  parties = memoryPartyStore();
  grants = memoryAccountGrants();
  await grants.save({ grantId: CHARLOTTE_GRANT.grantId, fleetId: FLEET_ID, accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, scopes: [], refreshToken: 'r', accountToken: 'a', accountTokenExpiresAt: ASKED_AT });
  isOn = true;
});

function askForServer() {
  const clock = { now: () => ASKED_AT };
  return createAskForServer({
    grants,
    parties,
    openRequest: createOpenRequest({ requests, ids: { newRequestId: () => 'req_1' }, clock }),
    servesOutsideParties: () => Promise.resolve(isOn),
  });
}

describe('a person asks for an outside MCP server', () => {
  it('opens a pending request for its address as their account, for 7 days', async () => {
    await expect(askForServer()({ caller: CHARLOTTE_GRANT, url: LINEAR })).resolves.toEqual({
      isOk: true,
      value: { requestId: 'req_1', url: LINEAR, state: 'pending', expiresAt: new Date('2026-10-27T09:00:00.000Z') },
    });
    expect(requests.held.map(({ subject, requesters }) => ({ subject, requesters }))).toEqual([
      { subject: { kind: 'server', url: LINEAR }, requesters: [{ accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID }] },
    ]);
  });

  it('asks for the address as a URL reads it, so the same server written two ways is one request', async () => {
    await askForServer()({ caller: CHARLOTTE_GRANT, url: 'HTTPS://MCP.Linear.app:443/mcp' });

    expect(requests.held.map(({ subject }) => subject)).toEqual([{ kind: 'server', url: LINEAR }]);
  });

  it.each([
    ['no URL', 'linear'],
    ['another scheme', 'ftp://mcp.linear.app/mcp'],
  ])('refuses %s, opening nothing', async (_what, url) => {
    await expect(askForServer()({ caller: CHARLOTTE_GRANT, url })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_SERVER_URL' } });
    expect(requests.held).toEqual([]);
  });

  it('says which outside party a server is already, opening nothing', async () => {
    await parties.save({ fleetId: FLEET_ID, name: 'linear', kind: 'mcpServer', url: LINEAR, credential: { kind: 'bearer', token: 't' }, concurrencyLimit: 4, ownerShipId: OWNER_SHIP_ID, state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'c', requestId: 'r', requestHash: 'h', approvedAt: ASKED_AT });

    await expect(askForServer()({ caller: CHARLOTTE_GRANT, url: LINEAR })).resolves.toEqual({ isOk: false, error: { kind: 'PARTY_EXISTS', message: `${LINEAR} is the outside party linear already` } });
    expect(requests.held).toEqual([]);
  });

  it('refuses a person whose sign-in ended', async () => {
    await expect(askForServer()({ caller: { fleetId: FLEET_ID, grantId: 'grant-gone' }, url: LINEAR })).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGNED_OUT' } });
  });

  it("is refused while the fleet's outside parties are off, opening nothing (interop I-3)", async () => {
    isOn = false;

    await expect(askForServer()({ caller: CHARLOTTE_GRANT, url: LINEAR })).resolves.toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
    expect(requests.held).toEqual([]);
  });
});
