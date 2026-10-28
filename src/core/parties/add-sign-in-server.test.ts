import type { FleetId } from '@aeolus-fleet/common';

import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { ATTIO_SIGN_IN, OWNER_SHIP_ID, fakeAuthorizationServers, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { err, ok } from '../shared/result.js';
import { createAddSignInServer } from './add-sign-in-server.js';
import { createApproveParty } from './approve-party.js';
import type { AuthorizationServers } from './ports.js';

const AT = new Date('2026-10-28T13:00:00.000Z');
const ATTIO_URL = 'https://mcp.attio.com/mcp';
const REDIRECT_URI = 'https://gateway.example.com/outside-parties/sign-in/done';
const OTHER_FLEET_ID: FleetId = 'flt_01m3tbfspe96yf1rnr4ank9oth';

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
});

function adding(servers: AuthorizationServers, isServing = true) {
  const servesOutsideParties = () => Promise.resolve(isServing);
  const approveParty = createApproveParty({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties, clock: { now: () => AT } });
  return createAddSignInServer({ approveParty, parties, servers, servesOutsideParties, redirectUri: REDIRECT_URI });
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
