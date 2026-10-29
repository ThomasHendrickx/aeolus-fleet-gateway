import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { ConnectionStore, GatewayCrew } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { APPROVING_SCOPE } from './approver.js';
import type { A2aAgentParty, McpServerParty } from './party.js';
import type { PartyStore, ProxyShipsAsActor } from './ports.js';

export type ApprovingRefusal = DomainError<'NOT_AN_APPROVER' | 'NO_SUCH_PARTY' | 'PARTY_NOT_COMMISSIONED' | 'NOT_CONNECTED' | 'FLEET_UNAVAILABLE' | 'NOT_REACHABLE'>;

export type CheckApproving = (input: { actor: Actor; as: ActorCredential; name: string }) => Promise<Result<undefined, ApprovingRefusal>>;

export interface ApprovingDeps {
  parties: PartyStore;
  connections: Pick<ConnectionStore, 'find'>;
  fleet: Pick<ProxyShipsAsActor, 'checkManage'>;
  credentialOf: CredentialOf;
}

/**
 * The outside MCP server or A2A agent an actor approves, with the gateway's
 * connection: the actor holds gateway:approve, and the fleet, asked as the
 * actor, answers that it manages the party's proxy ship (A2). The fleet
 * records a refusal.
 */
export async function approvedParty(deps: ApprovingDeps, { actor, as, name }: Parameters<CheckApproving>[0]): Promise<Result<{ party: McpServerParty | A2aAgentParty; gateway: GatewayCrew }, ApprovingRefusal>> {
  if (!actor.scopes.includes(APPROVING_SCOPE)) {
    return refuse('NOT_AN_APPROVER', `Setting the scopes an outside party needs takes ${APPROVING_SCOPE}`);
  }
  const party = await deps.parties.find(actor.fleetId, name);
  if (party?.kind !== 'mcpServer' && party?.kind !== 'a2aAgent') {
    return refuse('NO_SUCH_PARTY', `There is no outside MCP server or A2A agent ${name}`);
  }
  if (party.proxyShipId === null) {
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
  const managed = await deps.fleet.checkManage(credential.value, { shipId: party.proxyShipId });
  if (!managed.isOk) {
    return managed.error.code === 'UNAVAILABLE'
      ? refuse('FLEET_UNAVAILABLE', `The fleet did not say whether you manage ${name}: ${managed.error.message}`)
      : refuse('NOT_REACHABLE', managed.error.message);
  }
  return ok({ party, gateway });
}

/**
 * Use case: whether an actor approves an outside MCP server or A2A agent
 * (gateway scopes 4.3): the party's page shows its controls only then, and
 * the same table read-only otherwise.
 */
export function createCheckApproving(deps: ApprovingDeps): CheckApproving {
  return async (input) => {
    const approved = await approvedParty(deps, input);
    return approved.isOk ? ok(undefined) : approved;
  };
}
