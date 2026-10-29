import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { OAuthClients, OAuthSecrets } from '../oauth/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ApproveClientParty, ApprovePartyRefusal } from './approve-party.js';
import { APPROVING_SCOPE, EVERY_APP_SHIP_SCOPES, scopeNotHeld } from './approver.js';
import type { PartyStore } from './ports.js';
import type { ShownParty } from './shown-party.js';

export type AddClientPartyRefusal = DomainError<'NOT_AN_APPROVER' | 'SCOPE_NOT_HELD' | 'CLIENT_HAS_PARTY'> | ApprovePartyRefusal;

/** A client party as its approver reads it once: its client id, and its secret only when this call crewed its proxy ship. */
export interface AddedClientParty {
  readonly party: ShownParty;
  readonly clientId: string;
  readonly clientSecret: string | null;
}

export type AddClientParty = (input: { actor: Actor; requestId: string; name: string; ownerShipId: ShipId; scopes: readonly string[] }) => Promise<Result<AddedClientParty, AddClientPartyRefusal>>;

/**
 * Use case: an actor holding gateway:approve adds a client party with no
 * human at the authorize step (vendor platforms V4): its name, its owner and
 * scopes, only scopes it holds. The gateway commissions and crews its
 * mcp-client proxy ship as for any client party, the same request again
 * picking up where the last one stopped. Its OAuth client signs in by client
 * credentials, with no redirect URI. Its secret is answered once, when this
 * call crews the proxy ship, and kept only as its hash; a party left
 * awaiting crew gets its secret when parties.crew crews it.
 */
export function createAddClientParty(deps: {
  parties: Pick<PartyStore, 'find'>;
  approveClientParty: ApproveClientParty;
  clients: OAuthClients;
  secrets: OAuthSecrets;
}): AddClientParty {
  return async ({ actor, requestId, name, ownerShipId, scopes }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Adding a client party needs ${APPROVING_SCOPE}`);
    }
    const notHeld = scopeNotHeld(actor, scopes);
    if (notHeld !== undefined) {
      return refuse('SCOPE_NOT_HELD', `You may grant only scopes you hold: not ${notHeld}`);
    }
    const earlier = await deps.parties.find(actor.fleetId, name);
    // The same request again keeps its client id; a new one is told apart by its request id.
    const clientId = earlier?.kind === 'mcpClient' ? earlier.clientId : `client-${deps.secrets.newSecret()}`;
    const granted = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.has(scope));
    const approved = await deps.approveClientParty({ operatorFleetId: actor.fleetId, requestId, name, clientId, ownerShipId, scopes: granted });
    if (!approved.isOk) {
      return approved;
    }
    const party = approved.value;
    if (earlier?.state === 'crewed') {
      return ok({ party, clientId, clientSecret: null });
    }
    const clientSecret = party.state === 'crewed' ? deps.secrets.newSecret() : null;
    await deps.clients.save({ clientId, fleetId: actor.fleetId, name, redirectUris: [], secretHash: clientSecret === null ? null : deps.secrets.hashOf(clientSecret), grant: 'clientCredentials' });
    return ok({ party, clientId, clientSecret });
  };
}
