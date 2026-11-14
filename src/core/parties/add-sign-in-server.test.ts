import type { FleetId } from '@aeolus-fleet/common';

import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { ATTIO_SIGN_IN, OWNER_SHIP_ID, PROXY_SHIP_ID, fakeAuthorizationServers, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { PartySignIns } from '../party-grants/ports.js';
import { err, ok } from '../shared/result.js';
import { createAddSignInServer } from './add-sign-in-server.js';
import { createApproveParty } from './approve-party.js';
import type { AuthorizationServers } from './ports.js';

const AT = new Date('2026-10-28T13:00:00.000Z');
const ATTIO_URL = 'https://mcp.attio.com/mcp';
const REDIRECT_URI = 'https://gateway.example.com/outside-parties/sign-in/done';
const OTHER_FLEET_ID: FleetId = 'flt_01m3tbfspe96yf1rnr4ank9oth';

const deletedClients: string[] = [];
let deletion: Awaited<ReturnType<PartySignIns['deleteClient']>> = ok(undefined);
const signIns: Pick<PartySignIns, 'deleteClient'> = { deleteClient: (client) => { deletedClients.push(client.clientId); return Promise.resolve(deletion); } };

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  deletedClients.length = 0;
  deletion = ok(undefined);
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
});

function adding(servers: AuthorizationServers, isServing = true) {
  const servesOutsideParties = () => Promise.resolve(isServing);
  const approveParty = createApproveParty({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties, clock: { now: () => AT } });
  return createAddSignInServer({ approveParty, parties, servers, signIns, servesOutsideParties, redirectUri: REDIRECT_URI });
}

function anAddition(overrides: Partial<Parameters<ReturnType<typeof adding>>[0]> = {}): Parameters<ReturnType<typeof adding>>[0] {
  return { operatorFleetId: FLEET_ID, requestId: 'a-1', name: 'attio', url: ATTIO_URL, ownerShipId: OWNER_SHIP_ID, scopes: [], concurrencyLimit: 4, toolSwitches: null, ...overrides };
}

describe('an approver adds an outside MCP server where each person signs in (decision 0067)', () => {
  it('registers one client for the party, keeps it bound to its issuer and commissions the proxy ship', async () => {
    const attio = fakeAuthorizationServers();

    await expect(adding(attio.servers)(anAddition())).resolves.toMatchObject({ isOk: true, value: { name: 'attio', kind: 'mcpServer', credentialKind: 'personSignIn', state: 'crewed' } });
    expect(attio.registered).toEqual([{ registrationEndpoint: 'https://app.attio.com/oauth/register', clientName: 'Aeolus: attio', redirectUri: REDIRECT_URI, scope: 'mcp offline_access openid' }]);
    expect(fleet.state.commissioned).toMatchObject([{ name: 'attio', type: 'mcp-server', owner: OWNER_SHIP_ID }]);
    await expect(parties.find(FLEET_ID, 'attio')).resolves.toMatchObject({
      credential: {
        kind: 'personSignIn',
        client: {
          source: 'automatic',
          isGatewayOwned: true,
          tokenEndpointAuthMethod: 'client_secret_post',
          issuer: 'https://app.attio.com',
          clientId: 'client-1',
          clientSecret: 'secret-1',
          authorizationEndpoint: ATTIO_SIGN_IN.authorizationEndpoint,
          tokenEndpoint: ATTIO_SIGN_IN.tokenEndpoint,
          revocationEndpoint: null,
          isIssuerInResponse: false,
          resource: 'https://mcp.attio.com/mcp',
          scope: 'mcp offline_access openid',
        },
      },
    });
  });

  it("writes the issuer beside the server's host as the proxy ship's verified facts, naming the party's client and no person (decision 0067)", async () => {
    const attio = fakeAuthorizationServers();

    await adding(attio.servers)(anAddition());

    expect(fleet.state.verified.get(PROXY_SHIP_ID)?.facts).toEqual([
      { checked: 'tlsHost', value: 'mcp.attio.com' },
      { checked: 'oauthSubject', issuer: 'https://app.attio.com', value: 'client-1' },
    ]);
  });

  it('keeps that the authorization server states its issuer in each authorization response, so a response without it is refused (RFC 9207)', async () => {
    const attio = fakeAuthorizationServers(ok({ ...ATTIO_SIGN_IN, isIssuerInResponse: true }));

    await adding(attio.servers)(anAddition());

    await expect(parties.find(FLEET_ID, 'attio')).resolves.toMatchObject({ credential: { client: { isIssuerInResponse: true } } });
  });

  it('is refused naming PKCE S256 when the authorization server does not state it, keeping nothing', async () => {
    const attio = fakeAuthorizationServers(ok({ ...ATTIO_SIGN_IN, codeChallengeMethods: ['plain'] }));

    const added = await adding(attio.servers)(anAddition());

    expect(added).toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_CHECK_FAILED' } });
    expect(!added.isOk && added.error.message).toContain('PKCE S256');
    expect({ registered: attio.registered, commissioned: fleet.state.commissioned, parties: parties.held.size }).toEqual({ registered: [], commissioned: [], parties: 0 });
  });

  it('is refused when the server offers no dynamic registration, keeping nothing', async () => {
    const attio = fakeAuthorizationServers(ok({ ...ATTIO_SIGN_IN, registrationEndpoint: null }));

    await expect(adding(attio.servers)(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_DYNAMIC_REGISTRATION' } });
    expect({ commissioned: fleet.state.commissioned, parties: parties.held.size }).toEqual({ commissioned: [], parties: 0 });
  });

  it('is refused when the server names no authorization server, keeping nothing', async () => {
    const attio = fakeAuthorizationServers(err({ kind: 'noAuthorizationServer', reason: 'no resource_metadata' }));

    await expect(adding(attio.servers)(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_AUTHORIZATION_SERVER' } });
    expect(parties.held.size).toBe(0);
  });

  it('is refused naming the check when the authorization server metadata is missing or its issuer does not match, keeping nothing', async () => {
    const attio = fakeAuthorizationServers(err({ kind: 'noServerMetadata', reason: 'issuer https://evil.example.com is not https://app.attio.com' }));

    const added = await adding(attio.servers)(anAddition());

    expect(added).toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_CHECK_FAILED' } });
    expect(!added.isOk && added.error.message).toContain('issuer https://evil.example.com');
    expect(parties.held.size).toBe(0);
  });

  it('is refused while the server cannot be reached, keeping nothing', async () => {
    const attio = fakeAuthorizationServers(err({ kind: 'unreachable', reason: 'ECONNREFUSED' }));

    await expect(adding(attio.servers)(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE' } });
    expect(parties.held.size).toBe(0);
  });

  it("is refused with the server's error when it refuses the registration, keeping nothing", async () => {
    const attio = fakeAuthorizationServers(ok(ATTIO_SIGN_IN), err({ reason: 'invalid_redirect_uri' }));

    const added = await adding(attio.servers)(anAddition());

    expect(added).toMatchObject({ isOk: false, error: { kind: 'REGISTRATION_REFUSED' } });
    expect(!added.isOk && added.error.message).toContain('invalid_redirect_uri');
    expect({ commissioned: fleet.state.commissioned, parties: parties.held.size }).toEqual({ commissioned: [], parties: 0 });
  });

  it("is refused while the fleet's outside parties are off, registering nothing (interop I-3)", async () => {
    const attio = fakeAuthorizationServers();

    await expect(adding(attio.servers, false)(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
    expect(attio.registered).toEqual([]);
  });

  it('refuses a name a party holds, registering nothing', async () => {
    const attio = fakeAuthorizationServers();
    await adding(attio.servers)(anAddition());

    await expect(adding(attio.servers)(anAddition({ requestId: 'a-2' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_EXISTS' } });
    expect(attio.registered).toHaveLength(1);
  });

  it('answers a repeated addition with the party, registering and commissioning nothing again', async () => {
    const attio = fakeAuthorizationServers();
    await adding(attio.servers)(anAddition());

    await expect(adding(attio.servers)(anAddition())).resolves.toMatchObject({ isOk: true, value: { name: 'attio', state: 'crewed' } });
    expect({ registered: attio.registered.length, commissioned: fleet.state.commissioned.length }).toEqual({ registered: 1, commissioned: 1 });
  });

  it('registers a client of its own for each fleet that adds the same server (Q4)', async () => {
    await connections.save({ fleetId: OTHER_FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
    const attio = fakeAuthorizationServers();
    const add = adding(attio.servers);

    await add(anAddition());
    await add(anAddition({ operatorFleetId: OTHER_FLEET_ID, requestId: 'b-1' }));

    const clientIds = await Promise.all([FLEET_ID, OTHER_FLEET_ID].map(async (fleetId) => {
      const party = await parties.find(fleetId, 'attio');
      return party?.kind === 'mcpServer' && party.credential.kind === 'personSignIn' ? party.credential.client.clientId : undefined;
    }));
    expect(clientIds).toEqual(['client-1', 'client-2']);
  });
});

describe("the outside scopes a person's sign-in asks for (Q8)", () => {
  it("asks the 401's scope when the server named one, with offline_access and openid when listed", async () => {
    const attio = fakeAuthorizationServers(ok({ ...ATTIO_SIGN_IN, challengeScope: 'records:read' }));

    await adding(attio.servers)(anAddition());

    expect(attio.registered[0]?.scope).toBe('records:read offline_access openid');
  });

  it('asks every scope the server lists when its 401 named none, and neither offline_access nor openid when the authorization server lists neither', async () => {
    const attio = fakeAuthorizationServers(ok({ ...ATTIO_SIGN_IN, resourceScopes: ['mcp', 'records'], serverScopes: ['mcp', 'records'] }));

    await adding(attio.servers)(anAddition());

    expect(attio.registered[0]?.scope).toBe('mcp records');
  });
});

 it('refuses the registration method when discovery does not support it, keeping nothing', async () => {
   const attio = fakeAuthorizationServers(ok({ ...ATTIO_SIGN_IN, tokenEndpointAuthMethods: ['client_secret_basic'] }));
   await expect(adding(attio.servers)(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_CHECK_FAILED' } });
   expect(attio.registered).toEqual([]);
   expect(parties.held.size).toBe(0);
 });

function managedServers(): AuthorizationServers {
  const { servers } = fakeAuthorizationServers();
  return { ...servers, register: async (endpoint, input) => {
    const result = await servers.register(endpoint, input);
    return result.isOk ? ok({ ...result.value, registrationClientUri: 'https://app.attio.com/client/1', registrationAccessToken: 'management-token' }) : result;
  } };
}

describe('commission refusal after automatic registration', () => {
  it('deletes only the registered client after definite refusal and keeps no party', async () => {
    fleet.state.validOwners.clear();
    await expect(adding(managedServers())(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'COMMISSION_REFUSED' } });
    expect(deletedClients).toEqual(['client-1']);
    expect(parties.held.size).toBe(0);
  });

  it('reports a failed delete while preserving the commission refusal', async () => {
    fleet.state.validOwners.clear();
    deletion = err({ reason: 'HTTP 503' });
    const result = await adding(managedServers())(anAddition());
    expect(result).toMatchObject({ isOk: false, error: { kind: 'COMMISSION_REFUSED' } });
    expect(!result.isOk && result.error.message).toContain('client deletion failed');
    expect(deletedClients).toEqual(['client-1']);
  });

  it('keeps the client on an uncertain outcome and deletes it if the resumed commission is refused', async () => {
    fleet.state.isAnswering = false;
    const add = adding(managedServers());
    await expect(add(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(deletedClients).toEqual([]);
    expect(parties.held.size).toBe(1);
    fleet.state.isAnswering = true;
    fleet.state.validOwners.clear();
    await add(anAddition());
    expect(deletedClients).toEqual(['client-1']);
  });

  it.each(['fixed', 'url'] as const)('never deletes a supplied %s client on resumed refusal', async (source) => {
    fleet.state.isAnswering = false;
    const add = adding(managedServers());
    await add(anAddition());
    const party = await parties.find(FLEET_ID, 'attio');
    expect(party).toMatchObject({ kind: 'mcpServer', credential: { kind: 'personSignIn' } });
    if (party?.kind !== 'mcpServer' || party.credential.kind !== 'personSignIn') { return; }
    await parties.save({ ...party, credential: { kind: 'personSignIn', client: { ...party.credential.client, source, isGatewayOwned: false } } });
    fleet.state.isAnswering = true;
    fleet.state.validOwners.clear();
    await add(anAddition());
    expect(deletedClients).toEqual([]);
  });

  it('does not delete a client without registration management credentials', async () => {
    fleet.state.validOwners.clear();
    await adding(fakeAuthorizationServers().servers)(anAddition());
    expect(deletedClients).toEqual([]);
  });
});
