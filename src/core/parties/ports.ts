import type { FleetId, ShipId, VerifiedFact } from '@aeolus-fleet/common';

import type { ActorCredential } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';
import type { Party } from './party.js';
import type { ScopeRequirements, ScopeRequirementsChange } from './scope-requirements.js';
import type { FromFleet } from './shown-party.js';
import type { ToolSwitches } from './tool-switches.js';

/** Outbound port: the parties argo approved, one per proxy ship name in a fleet. */
export interface PartyStore {
  find(fleetId: FleetId, name: string): Promise<Party | undefined>;
  list(fleetId: FleetId): Promise<Party[]>;
  /** The party an MCP client is in the fleet, if argo approved it. */
  findByClient(fleetId: FleetId, clientId: string): Promise<Party | undefined>;
  /** The party whose bearer has this hash, in whichever fleet: the bearer alone names an A2A client (decision 0060), as a token hash is looked up unscoped (0007). */
  findByBearer(bearerHash: string): Promise<Party | undefined>;
  /** Keeps the party; a server's tool switches only when it is new, as only switchTools changes them after. */
  save(party: Party): Promise<void>;
  /**
   * Keeps the server's switches given beside the ones kept, at once. A party
   * with none kept first keeps every tool listed on, so switching one tool
   * leaves every other as it was.
   */
  switchTools(party: { fleetId: FleetId; name: string }, change: { listed: readonly string[]; switched: ToolSwitches }): Promise<void>;
  remove(fleetId: FleetId, name: string): Promise<void>;
}

/** Outbound port: each party's required scopes (design gateway-scopes, 4.2), kept with the party and gone with it. */
export interface ScopeRequirementsStore {
  /** The party's requirements as they are now; none set yet is version 0, needing nothing. */
  find(fleetId: FleetId, party: string): Promise<ScopeRequirements>;
  /**
   * Makes the change, all at once and only while the requirements are still
   * at the version named: the requirements after, at the next version; none
   * once another change moved them on.
   */
  change(party: { fleetId: FleetId; name: string }, change: ScopeRequirementsChange & { version: number }): Promise<ScopeRequirements | undefined>;
}

/** Outbound port: the fleet's calls the gateway makes for a party's proxy ship. */
export interface ProxyShipDoor {
  /**
   * Commissions an app ship as the gateway's ship (fleet:commission and
   * fleet:on-behalf, decision 0044), owned by the owner argo picked (0045),
   * with the scopes granted, only ones the gateway's ship holds (0053),
   * under the gateway's idempotency key: its id, and on the first commission
   * its secret. A repeat under the same key answers the same ship without one.
   */
  commissionAppShip(
    crewToken: string,
    ship: { name: string; type: string; owner: ShipId; idempotencyKey: string; scopes: readonly string[] },
  ): Promise<Result<{ shipId: ShipId; secret: string | null }, FleetRefusal>>;
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
  /** Sets the gateway's facts about the proxy ship whole (fleet.setVerifiedFacts, fleet:verify, decision 0059). */
  setVerifiedFacts(crewToken: string, written: { shipId: ShipId; facts: readonly VerifiedFact[] }): Promise<Result<undefined, FleetRefusal>>;
}

/** Outbound port: the fleet's calls on a party's proxy ship made as the actor (decision 0057), so the fleet checks its scopes and reach. */
export interface ProxyShipsAsActor {
  /** Retires the proxy ship (fleet.retire); a ship retired already is refused with CONFLICT. */
  retire(as: ActorCredential, ship: { shipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
  /** Sets the proxy ship's owner (fleet.setOwner, fleet:owner). */
  setOwner(as: ActorCredential, ship: { shipId: ShipId; ownerShipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
  /** Grants and revokes the proxy ship's scopes (fleet.grantScopes, scopes:grant): every scope it holds now. */
  grantScopes(as: ActorCredential, change: { shipId: ShipId; grant: readonly string[]; revoke: readonly string[] }): Promise<Result<{ scopes: string[] }, FleetRefusal>>;
  /** Whether the actor manages the proxy ship now (fleet.checkManage, no scope): OK, or the fleet's refusal, which it records. */
  checkManage(as: ActorCredential, ship: { shipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
}

/** Outbound port: what the fleet holds for a proxy ship, read as the actor (fleet:read): its name, owner and scopes, only its name outside the actor's read reach. */
export interface ProxyShipReads {
  read(as: ActorCredential, ship: { shipId: ShipId }): Promise<Result<FromFleet, FleetRefusal>>;
}

/** A ship of the fleet as fleet.list answers it within the actor's read reach. */
export interface FleetShip {
  shipId: ShipId;
  name: string;
  kind: 'operator' | 'agent' | 'viewer' | 'person' | 'app' | 'plugin';
  status: 'awaitingCrew' | 'crewed' | 'retired';
}

/** Outbound port: the fleet's ships, read as the actor (fleet.list), within its read reach. */
export interface FleetShips {
  list(as: ActorCredential): Promise<Result<FleetShip[], FleetRefusal>>;
}

/** What an outside MCP server says about its sign-in: its protected resource metadata (RFC 9728) and its authorization server's metadata (RFC 8414 or OpenID Connect). */
export interface DiscoveredSignIn {
  /** The resource indicator the server names itself by. */
  readonly resource: string;
  /** The scope its 401 named, if it named one. */
  readonly challengeScope: string | null;
  /** The scopes its protected resource metadata lists. */
  readonly resourceScopes: readonly string[];
  /** The authorization server's issuer, matching the one the server named. */
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | null;
  readonly revocationEndpoint: string | null;
  /** Whether it states its issuer in each authorization response (RFC 9207). */
  readonly isIssuerInResponse: boolean;
  readonly codeChallengeMethods: readonly string[];
  /** The scopes the authorization server lists. */
  readonly serverScopes: readonly string[];
}

/**
 * Why a server's sign-in could not be found:
 * - noAuthorizationServer: its 401 and its well-known address name no protected resource metadata;
 * - noServerMetadata: the authorization server it names has no metadata, or metadata whose issuer is not the one named;
 * - unreachable: the server or its authorization server did not answer.
 */
export interface DiscoveryFailure {
  readonly kind: 'noAuthorizationServer' | 'noServerMetadata' | 'unreachable';
  readonly reason: string;
}

/** What dynamic registration answered (RFC 7591, 7592). */
export interface RegisteredClient {
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly registrationClientUri: string | null;
  readonly registrationAccessToken: string | null;
}

/** Outbound port: outside MCP servers' authorization servers, as the gateway, an OAuth client, reaches them. */
export interface AuthorizationServers {
  discover(serverUrl: string): Promise<Result<DiscoveredSignIn, DiscoveryFailure>>;
  /** Registers a confidential client for the authorization code flow; the server's own error when it refuses or does not answer. */
  register(registrationEndpoint: string, client: { clientName: string; redirectUri: string; scope: string }): Promise<Result<RegisteredClient, { readonly reason: string }>>;
}
