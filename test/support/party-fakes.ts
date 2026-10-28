import type { FleetId, ShipId, VerifiedFact } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal } from '../../src/core/connection/ports.js';
import type { Party } from '../../src/core/parties/party.js';
import type { ActorCredential } from '../../src/core/actors/credential-of.js';
import type { AuthorizationServers, DiscoveredSignIn, DiscoveryFailure, PartyStore, ProxyShipDoor, ProxyShipReads, ProxyShipsAsActor, ScopeRequirementsStore } from '../../src/core/parties/ports.js';
import { changedRequirements, NO_SCOPE_REQUIREMENTS, type ScopeRequirements } from '../../src/core/parties/scope-requirements.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';
import { FLEET_ID } from './fleet-fakes.js';

export const OWNER_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
export const PROXY_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9crm';

/** The parties in memory, by fleet and name. */
export function memoryPartyStore(): PartyStore & { held: Map<string, Party> } {
  const held = new Map<string, Party>();
  const key = (fleetId: FleetId, name: string) => `${fleetId}/${name}`;
  return {
    held,
    find: (fleetId, name) => Promise.resolve(held.get(key(fleetId, name))),
    list: (fleetId) => Promise.resolve([...held.values()].filter((party) => party.fleetId === fleetId)),
    findByClient: (fleetId, clientId) => Promise.resolve([...held.values()].find((party) => party.fleetId === fleetId && party.kind === 'mcpClient' && party.clientId === clientId)),
    findByBearer: (bearerHash) => Promise.resolve([...held.values()].find((party) => party.kind === 'a2aClient' && party.bearerHash === bearerHash)),
    // A server's tool switches change only by switchTools once it is kept, as the store keeps them.
    save: (party) => {
      const earlier = held.get(key(party.fleetId, party.name));
      held.set(key(party.fleetId, party.name), party.kind === 'mcpServer' && earlier?.kind === 'mcpServer' ? { ...party, toolSwitches: earlier.toolSwitches } : party);
      return Promise.resolve();
    },
    switchTools: ({ fleetId, name }, { listed, switched }) => {
      const party = held.get(key(fleetId, name));
      if (party?.kind === 'mcpServer') {
        const kept = party.toolSwitches ?? new Map(listed.map((tool) => [tool, true]));
        held.set(key(fleetId, name), { ...party, toolSwitches: new Map([...kept, ...switched]) });
      }
      return Promise.resolve();
    },
    remove: (fleetId, name) => {
      held.delete(key(fleetId, name));
      return Promise.resolve();
    },
  };
}

/** Each party's required scopes in memory, by fleet and name, changed only at the version they were read at. */
export function memoryScopeRequirements(): ScopeRequirementsStore & { held: Map<string, ScopeRequirements> } {
  const held = new Map<string, ScopeRequirements>();
  const key = (fleetId: FleetId, name: string) => `${fleetId}/${name}`;
  return {
    held,
    find: (fleetId, party) => Promise.resolve(held.get(key(fleetId, party)) ?? NO_SCOPE_REQUIREMENTS),
    change: ({ fleetId, name }, change) => {
      const kept = held.get(key(fleetId, name)) ?? NO_SCOPE_REQUIREMENTS;
      if (kept.version !== change.version) {
        return Promise.resolve(undefined);
      }
      const changed = changedRequirements(kept, change);
      held.set(key(fleetId, name), changed);
      return Promise.resolve(changed);
    },
  };
}

/**
 * A fleet that commissions the gateway's app ships as core does (#959): once
 * per idempotency key, its secret only on the first commission, owned by an
 * active person's ship or argo; and lets the secret claim the ship once.
 */
export function fakeProxyShipFleet() {
  const state = {
    isAnswering: true,
    /** Whether a register is answered; the fleet may answer the commission and then go quiet. */
    isRegisterAnswering: true,
    validOwners: new Set<ShipId>([OWNER_SHIP_ID]),
    commissioned: new Array<{ name: string; type: string; owner: ShipId; idempotencyKey: string; scopes: readonly string[] }>(),
    /** The scopes the gateway's ship holds, so a commission gives no other (decision 0053). */
    gatewayScopes: new Set(['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify']),
    keys: new Map<string, ShipId>(),
    secrets: new Map<ShipId, string>(),
    crewed: new Set<ShipId>(),
    /** Dies after the next commission is stored, before its answer arrives. */
    isLosingNextAnswer: false,
    /** The facts each writer, by its crew token, set about each ship (decision 0059). */
    verified: new Map<ShipId, { crewToken: string; facts: readonly VerifiedFact[] }>(),
    /** Whether setVerifiedFacts is refused, as for a ship outside the gateway's manage reach. */
    isVerifyRefused: false,
  };
  const unavailable = (): Promise<Result<never, FleetRefusal>> => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
  const door: ProxyShipDoor & Pick<FleetDoor, 'whoami'> = {
    commissionAppShip: (_crewToken, ship) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      if (!state.validOwners.has(ship.owner)) {
        return Promise.resolve(err({ code: 'BAD_REQUEST', message: 'The owner is an active person ship or argo (decision 0045)' }));
      }
      const notHeld = ship.scopes.find((scope) => !state.gatewayScopes.has(scope));
      if (notHeld !== undefined) {
        return Promise.resolve(err({ code: 'FORBIDDEN', message: `A commission gives only scopes the commissioner holds: not ${notHeld}` }));
      }
      const earlier = state.keys.get(ship.idempotencyKey);
      if (earlier !== undefined) {
        return Promise.resolve(ok({ shipId: earlier, secret: null }));
      }
      state.commissioned.push(ship);
      state.keys.set(ship.idempotencyKey, PROXY_SHIP_ID);
      state.secrets.set(PROXY_SHIP_ID, 'aeolus_sk_v1_proxy');
      if (state.isLosingNextAnswer) {
        state.isLosingNextAnswer = false;
        return unavailable();
      }
      return Promise.resolve(ok({ shipId: PROXY_SHIP_ID, secret: 'aeolus_sk_v1_proxy' }));
    },
    register: ({ shipId, secret }) => {
      if (!state.isAnswering || !state.isRegisterAnswering) {
        return unavailable();
      }
      if (state.secrets.get(shipId) !== secret || state.crewed.has(shipId)) {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' }));
      }
      state.crewed.add(shipId);
      return Promise.resolve(ok({ crewToken: 'aeolus_ct_v1_proxy' }));
    },
    // Every proxy ship's crew token is the same here, so it is taken while that ship is crewed.
    whoami: (crewToken) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      if (crewToken !== 'aeolus_ct_v1_proxy' || !state.crewed.has(PROXY_SHIP_ID)) {
        return Promise.resolve(err({ code: 'LEASE_ENDED', message: 'The crew was released' }));
      }
      return Promise.resolve(ok({ shipId: PROXY_SHIP_ID, fleetId: FLEET_ID, name: 'proxy', type: 'mcp-client' }));
    },
    setVerifiedFacts: (crewToken, { shipId, facts }) => {
      if (state.isVerifyRefused) {
        return Promise.resolve(err({ code: 'FORBIDDEN', message: 'The ship is outside your manage reach' }));
      }
      state.verified.set(shipId, { crewToken, facts });
      return Promise.resolve(ok(undefined));
    },
  };
  /** Releases the ship's crew (fleet.release), and gives it a new secret, as its new starting prompt does. */
  const release = (shipId: ShipId, secret: string) => {
    state.crewed.delete(shipId);
    state.secrets.set(shipId, secret);
  };
  return { state, door, release };
}

/** The fleet's calls on proxy ships as the actor, as a test sees them: each call with its credential, answered as given. */
export function fakeProxyShipsAsActor(answer: Result<undefined, FleetRefusal> = ok(undefined)): ProxyShipsAsActor & {
  retired: { as: ActorCredential; shipId: ShipId }[];
  owned: { as: ActorCredential; shipId: ShipId; ownerShipId: ShipId }[];
  granted: { as: ActorCredential; shipId: ShipId; grant: readonly string[]; revoke: readonly string[] }[];
  checked: { as: ActorCredential; shipId: ShipId }[];
} {
  const retired: { as: ActorCredential; shipId: ShipId }[] = [];
  const owned: { as: ActorCredential; shipId: ShipId; ownerShipId: ShipId }[] = [];
  const granted: { as: ActorCredential; shipId: ShipId; grant: readonly string[]; revoke: readonly string[] }[] = [];
  const checked: { as: ActorCredential; shipId: ShipId }[] = [];
  return {
    retired,
    owned,
    granted,
    checked,
    retire: (as, { shipId }) => {
      retired.push({ as, shipId });
      return Promise.resolve(answer);
    },
    setOwner: (as, { shipId, ownerShipId }) => {
      owned.push({ as, shipId, ownerShipId });
      return Promise.resolve(answer);
    },
    grantScopes: (as, { shipId, grant, revoke }) => {
      granted.push({ as, shipId, grant, revoke });
      return Promise.resolve(answer.isOk ? ok({ scopes: ['messages:send', 'messages:receive', ...grant] }) : answer);
    },
    checkManage: (as, { shipId }) => {
      checked.push({ as, shipId });
      return Promise.resolve(answer);
    },
  };
}

/** The fleet's answer for each proxy ship, read as the gateway's ship; a ship it has no answer for is as when the fleet does not answer. */
/** The fleet as an actor reads proxy ships: each ship as given, a ship outside the actor's read reach without its owner and scopes, any other unanswered. */
export function fakeProxyShipReads(
  ships: Readonly<Record<string, { proxyShipName: string; ownerShipId: ShipId | null; ownerName: string | null; scopes: string[] }>>,
  reach: { outsideReach: readonly ShipId[] } = { outsideReach: [] },
): ProxyShipReads & { readers: ActorCredential[] } {
  const readers: ActorCredential[] = [];
  return {
    readers,
    read: (as, { shipId }) => {
      readers.push(as);
      const ship = ships[shipId];
      if (ship === undefined) {
        return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
      }
      return Promise.resolve(ok(reach.outsideReach.includes(shipId) ? { proxyShipName: ship.proxyShipName, ownerShipId: null, ownerName: null, scopes: null } : ship));
    },
  };
}

/** A sign-in shaped as Attio's metadata (oauth-servers L10): its issuer and scopes, dynamic registration, PKCE S256, no revocation. */
export const ATTIO_SIGN_IN: DiscoveredSignIn = {
  resource: 'https://mcp.attio.com/mcp',
  challengeScope: null,
  resourceScopes: ['mcp', 'offline_access', 'openid'],
  issuer: 'https://app.attio.com',
  authorizationEndpoint: 'https://app.attio.com/oidc/authorize',
  tokenEndpoint: 'https://app.attio.com/oidc/token',
  registrationEndpoint: 'https://app.attio.com/oauth/register',
  revocationEndpoint: null,
  codeChallengeMethods: ['S256'],
  serverScopes: ['mcp', 'offline_access', 'openid'],
};

/** An authorization server double: answers the sign-in it is given, and registers a new client each time, counting them. */
export function fakeAuthorizationServers(discovered: Result<DiscoveredSignIn, DiscoveryFailure> = ok(ATTIO_SIGN_IN), registration: Result<undefined, { reason: string }> = ok(undefined)) {
  const registered: { registrationEndpoint: string; clientName: string; redirectUri: string; scope: string }[] = [];
  const servers: AuthorizationServers = {
    discover: () => Promise.resolve(discovered),
    register: (registrationEndpoint, client) => {
      if (!registration.isOk) {
        return Promise.resolve(err(registration.error));
      }
      registered.push({ registrationEndpoint, ...client });
      return Promise.resolve(ok({ clientId: `client-${String(registered.length)}`, clientSecret: `secret-${String(registered.length)}`, registrationClientUri: null, registrationAccessToken: null }));
    },
  };
  return { servers, registered };
}
