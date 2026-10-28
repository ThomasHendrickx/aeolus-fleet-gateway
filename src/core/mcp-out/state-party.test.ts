import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeMcpServers, fakeStatementDoor, memoryToolMarks } from '../../../test/support/mcp-out-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore, memoryScopeRequirements } from '../../../test/support/party-fakes.js';
import { aPartyGrant, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { createListingConnectionOf } from '../party-grants/listing-connection.js';
import type { McpServerParty } from '../parties/party.js';
import type { SignInClient } from '../vault/credential.js';
import { createMarkTool } from './mark-tool.js';
import { createStateParty } from './state-party.js';

const AT = new Date('2026-10-18T14:00:00.000Z');

/** A party's sign-in client, shaped as Attio's (oauth-servers L10). */
const ATTIO_CLIENT: SignInClient = {
  issuer: 'https://app.attio.com',
  authorizationEndpoint: 'https://app.attio.com/oidc/authorize',
  tokenEndpoint: 'https://app.attio.com/oidc/token',
  revocationEndpoint: null,
  clientId: 'client-1',
  clientSecret: 'secret-1',
  registrationClientUri: null,
  registrationAccessToken: null,
  resource: 'https://mcp.attio.com/mcp',
  scope: 'mcp offline_access openid',
};

const CRM: McpServerParty = {
  fleetId: FLEET_ID,
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp',
  credential: { kind: 'bearer', token: 'crm-token' },
  concurrencyLimit: 4,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_proxy',
  requestId: 'a-1',
  requestHash: 'h',
  approvedAt: AT,
  toolSwitches: new Map([
    ['list_contacts', true],
    ['create_deal', true],
  ]),
};

let parties: ReturnType<typeof memoryPartyStore>;
let servers: ReturnType<typeof fakeMcpServers>;
let door: ReturnType<typeof fakeStatementDoor>;
let marks: ReturnType<typeof memoryToolMarks>;
let requirements: ReturnType<typeof memoryScopeRequirements>;
let grants: ReturnType<typeof memoryPartyGrants>;
let stateParty: ReturnType<typeof createStateParty>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  servers = fakeMcpServers();
  door = fakeStatementDoor();
  marks = memoryToolMarks();
  requirements = memoryScopeRequirements();
  grants = memoryPartyGrants();
  stateParty = createStateParty({ parties, servers, door, marks, requirements, connectionOf: createListingConnectionOf({ grants, clock: { now: () => AT } }), timing: { waitMs: 10_000, deadlineMs: 300_000 } });
});

describe('the gateway states what a proxy ship offers, as its crew (decision 0047)', () => {
  it('leaves the proxy ship of a server where each person signs in unstated while nobody signed in, listing nothing (decision 0067)', async () => {
    await parties.save({ ...CRM, name: 'attio', credential: { kind: 'personSignIn', client: ATTIO_CLIENT }, toolSwitches: null });

    await expect(stateParty({ fleetId: FLEET_ID, name: 'attio' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_SIGNED_IN' } });
    expect({ listedWith: servers.listedWith, stated: door.stated }).toEqual({ listedWith: [], stated: [] });
  });

  it("states a server where each person signs in from a person's grant, listing its tools under the grant's access token (Q15)", async () => {
    await parties.save({ ...CRM, name: 'attio', credential: { kind: 'personSignIn', client: ATTIO_CLIENT }, toolSwitches: null });
    await grants.keep(aPartyGrant({ fleetId: FLEET_ID, party: 'attio', accessToken: 'access-mathilde', accessTokenEndsAt: new Date('2026-10-18T15:00:00.000Z') }));

    await expect(stateParty({ fleetId: FLEET_ID, name: 'attio' })).resolves.toEqual({ isOk: true, value: { capabilities: ['list_contacts', 'create_deal'] } });
    expect(servers.listedWith).toEqual([{ url: 'https://crm.example.com/mcp', credential: { kind: 'bearer', token: 'access-mathilde' } }]);
  });

  it('leaves it unstated while the only grant has an access token that ended, listing nothing', async () => {
    await parties.save({ ...CRM, name: 'attio', credential: { kind: 'personSignIn', client: ATTIO_CLIENT }, toolSwitches: null });
    await grants.keep(aPartyGrant({ fleetId: FLEET_ID, party: 'attio', accessTokenEndsAt: AT }));

    await expect(stateParty({ fleetId: FLEET_ID, name: 'attio' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_SIGNED_IN' } });
    expect(servers.listedWith).toEqual([]);
  });

  it("states the server's tools as the proxy ship, with its crew token", async () => {
    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toEqual({ isOk: true, value: { capabilities: ['list_contacts', 'create_deal'] } });
    expect(door.stated.map(({ crewToken, statement }) => [crewToken, statement.capabilities.map((capability) => capability.name)])).toEqual([['aeolus_ct_v1_proxy', ['list_contacts', 'create_deal']]]);
  });

  it('states the scopes each tool needs as they are now (P1)', async () => {
    await requirements.change({ fleetId: FLEET_ID, name: 'crm' }, { version: 0, tools: new Map([['create_deal', ['crm:write-leads']]]) });

    await stateParty({ fleetId: FLEET_ID, name: 'crm' });

    expect(door.stated[0]?.statement.capabilities.map(({ name, scopes }) => ({ name, scopes }))).toEqual([
      { name: 'list_contacts', scopes: undefined },
      { name: 'create_deal', scopes: ['crm:write-leads'] },
    ]);
  });

  it('calls the server with the credential from the vault', async () => {
    await stateParty({ fleetId: FLEET_ID, name: 'crm' });

    expect(servers.listedWith).toEqual([{ url: 'https://crm.example.com/mcp', credential: { kind: 'bearer', token: 'crm-token' } }]);
  });

  it('refuses while the server cannot be listed, stating nothing', async () => {
    servers.state.isReachable = false;

    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE' } });
    expect(door.stated).toEqual([]);
  });

  it('refuses when the fleet refuses the statement, saying why', async () => {
    door.state.refusal = { code: 'BAD_REQUEST', message: 'A statement is at most 65536 bytes (64 KB) as JSON in UTF-8' };

    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'STATEMENT_REFUSED', message: 'The fleet refused the statement: A statement is at most 65536 bytes (64 KB) as JSON in UTF-8' } });
  });

  it('refuses a party whose proxy ship it does not crew', async () => {
    await parties.save({ ...CRM, state: 'awaitingCrew', crewToken: null });

    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CREWED' } });
  });

  it('refuses a party it does not know', async () => {
    await expect(stateParty({ fleetId: FLEET_ID, name: 'erp' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});

describe("the fleet sees only the tools an approver switched on (aeolus-fleet#1151)", () => {
  const stated = () => door.stated.at(-1)?.statement.capabilities.map((capability) => capability.name);

  it('leaves a tool switched off out of the statement', async () => {
    await parties.save({ ...CRM, name: 'erp', toolSwitches: new Map([['list_contacts', true], ['create_deal', false]]) });

    await expect(stateParty({ fleetId: FLEET_ID, name: 'erp' })).resolves.toEqual({ isOk: true, value: { capabilities: ['list_contacts'] } });
    expect(stated()).toEqual(['list_contacts']);
  });

  it('leaves out a tool the server listed after its switches were kept: it starts off', async () => {
    await parties.save({ ...CRM, name: 'erp', toolSwitches: new Map([['list_contacts', true]]) });

    await stateParty({ fleetId: FLEET_ID, name: 'erp' });

    expect(stated()).toEqual(['list_contacts']);
  });

  it('keeps every tool it lists on for a party whose switches are not kept yet, so nothing it stated before goes', async () => {
    await parties.save({ ...CRM, name: 'erp', toolSwitches: null });

    await stateParty({ fleetId: FLEET_ID, name: 'erp' });

    expect(stated()).toEqual(['list_contacts', 'create_deal']);
    const kept = await parties.find(FLEET_ID, 'erp');
    expect(kept?.kind === 'mcpServer' && kept.toolSwitches).toEqual(new Map([['list_contacts', true], ['create_deal', true]]));
  });
});

describe("argo marks a tool repeatable (interop 5.2)", () => {
  it('states the mark at once', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });

    await markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: true });

    expect(door.stated.at(-1)?.statement.capabilities.find((capability) => capability.name === 'create_deal')?.repeatable).toBe(true);
  });

  it('takes the mark off again', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });
    await markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: true });

    await markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: false });

    expect(door.stated.at(-1)?.statement.capabilities.find((capability) => capability.name === 'create_deal')?.repeatable).toBeUndefined();
  });

  it('keeps the mark while the server cannot be listed, and states it once it can', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });
    servers.state.isReachable = false;
    await expect(markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE' } });
    servers.state.isReachable = true;

    await stateParty({ fleetId: FLEET_ID, name: 'crm' });

    expect(door.stated.at(-1)?.statement.capabilities.find((capability) => capability.name === 'create_deal')?.repeatable).toBe(true);
  });

  it('refuses a mark for a party it does not know, keeping nothing', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });

    await expect(markTool({ fleetId: FLEET_ID, name: 'erp', tool: 'x', isRepeatable: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
    expect(marks.held.size).toBe(0);
  });
});
