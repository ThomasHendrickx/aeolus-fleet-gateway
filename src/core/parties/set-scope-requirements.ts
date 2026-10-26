import type { StateA2aAgent } from '../a2a-out/state-a2a-agent.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { StateParty } from '../mcp-out/state-party.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { APPROVING_SCOPE } from './approver.js';
import type { PartyStore, ProxyShipsAsActor, ScopeRequirementsStore } from './ports.js';
import type { ScopeRequirements } from './scope-requirements.js';

export type SetScopeRequirementsRefusal = DomainError<'NOT_AN_APPROVER' | 'NO_SUCH_PARTY' | 'PARTY_NOT_COMMISSIONED' | 'NOT_REACHABLE' | 'NO_SUCH_TOOL' | 'NOT_CONNECTED' | 'FLEET_UNAVAILABLE' | 'SCOPE_NOT_LISTED' | 'CONFLICT'>;

export type SetScopeRequirements = (input: {
  actor: Actor;
  as: ActorCredential;
  name: string;
  /** The requirements' version the change was made on, as the approver read them. */
  version: number;
  party?: readonly string[];
  tools: ReadonlyMap<string, readonly string[]>;
}) => Promise<
  Result<{ requirements: ScopeRequirements; /** Why the proxy ship's statement waits for its next one; none when the fleet sees the change now. */ statementRefusal: string | null }, SetScopeRequirementsRefusal>
>;

const unique = (scopes: readonly string[]): string[] => [...new Set(scopes)];

/**
 * Use case: an approver sets which scopes a calling ship needs (design
 * gateway-scopes, 4.2, A2): for an outside MCP server the party's set and
 * any tool's, for an outside A2A agent its set as a whole. The fleet, asked
 * as the approver, must answer that it manages the proxy ship before
 * anything changes, clearing included; it records a refusal. Every scope must
 * be one the fleet lists now, core's, a plugin's or the fleet's own: any may
 * be required (0016). The change is made only on the version the approver
 * read, so two approvers never overwrite each other unseen. The change is
 * kept first, so the check holds at once, then the proxy ship is stated
 * anew with what each capability needs (P1); while it cannot be, the
 * statement waits for its next one.
 */
export function createSetScopeRequirements(deps: {
  parties: PartyStore;
  requirements: ScopeRequirementsStore;
  connections: Pick<ConnectionStore, 'find'>;
  door: Pick<FleetDoor, 'listScopes'>;
  stateParty: StateParty;
  stateA2aAgent: StateA2aAgent;
  fleet: Pick<ProxyShipsAsActor, 'checkManage'>;
  credentialOf: CredentialOf;
}): SetScopeRequirements {
  return async ({ actor, as, name, version, party, tools }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Setting the scopes an outside party needs takes ${APPROVING_SCOPE}`);
    }
    const kept = await deps.parties.find(actor.fleetId, name);
    if (kept?.kind !== 'mcpServer' && kept?.kind !== 'a2aAgent') {
      return refuse('NO_SUCH_PARTY', `There is no outside MCP server or A2A agent ${name}`);
    }
    if (kept.kind === 'a2aAgent' && tools.size > 0) {
      return refuse('NO_SUCH_TOOL', `${name} is an outside A2A agent: its messages name no tool, so set the scopes it needs as a whole`);
    }
    if (kept.proxyShipId === null) {
      return refuse('PARTY_NOT_COMMISSIONED', `${name}'s proxy ship is not commissioned yet`);
    }
    const gateway = await deps.connections.find(actor.fleetId);
    if (gateway === undefined) {
      return refuse('NOT_CONNECTED', 'The gateway is not connected to the fleet');
    }
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const managed = await deps.fleet.checkManage(credential.value, { shipId: kept.proxyShipId });
    if (!managed.isOk) {
      return managed.error.code === 'UNAVAILABLE'
        ? refuse('FLEET_UNAVAILABLE', `The fleet did not say whether you manage ${name}: ${managed.error.message}`)
        : refuse('NOT_REACHABLE', managed.error.message);
    }
    const change = { ...(party === undefined ? {} : { party: unique(party) }), tools: new Map([...tools].map(([tool, scopes]) => [tool, unique(scopes)])) };
    const required = unique([...(change.party ?? []), ...[...change.tools.values()].flat()]);
    if (required.length > 0) {
      const listed = await deps.door.listScopes(gateway.crewToken);
      if (!listed.isOk) {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not say which scopes it lists: ${listed.error.message}`);
      }
      const unlisted = required.filter((scope) => !listed.value.includes(scope));
      if (unlisted.length > 0) {
        return refuse('SCOPE_NOT_LISTED', `The fleet lists no scope ${unlisted.join(' or ')}: define it first, or pick a listed one`);
      }
    }
    const changed = await deps.requirements.change({ fleetId: actor.fleetId, name }, { ...change, version });
    if (changed === undefined) {
      return refuse('CONFLICT', 'The requirements changed since you opened this page');
    }
    const stated = await (kept.kind === 'mcpServer' ? deps.stateParty : deps.stateA2aAgent)({ fleetId: actor.fleetId, name });
    return ok({ requirements: changed, statementRefusal: stated.isOk ? null : stated.error.message });
  };
}
