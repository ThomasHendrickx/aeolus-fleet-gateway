import type { ShipId } from '@aeolus-fleet/common';

import type { ApprovingDeps, CheckApproving } from '../parties/check-approving.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { approvedSignInParty, type ApprovedSignInPartyRefusal } from './approved-sign-in-party.js';
import { endGrant } from './end-grant.js';
import type { PartyGrants, PartySignIns } from './ports.js';

export type RemoveGrant = (
  input: Parameters<CheckApproving>[0] & { personShipId: ShipId },
) => Promise<Result<{ /** Whether the authorization server revoked its tokens; false where it offers no revocation or did not answer. */ isRevoked: boolean }, ApprovedSignInPartyRefusal | DomainError<'NOT_SIGNED_IN'>>>;

/**
 * Use case: an actor holding gateway:approve within manage reach of an
 * outside MCP server's proxy ship removes any person's sign-in to it
 * (decision 0067, Q6), so the party is cut off for that person without
 * retiring it. It ends as every grant ends.
 */
export function createRemoveGrant(deps: ApprovingDeps & { grants: Pick<PartyGrants, 'ofPerson' | 'remove'>; signIns: Pick<PartySignIns, 'revoke'> }): RemoveGrant {
  return async ({ personShipId, ...asked }) => {
    const approved = await approvedSignInParty(deps, asked);
    if (!approved.isOk) {
      return approved;
    }
    const { name, client } = approved.value;
    const grant = await deps.grants.ofPerson(asked.actor.fleetId, { party: name, personShipId });
    if (grant === undefined) {
      return refuse('NOT_SIGNED_IN', `${personShipId} is not signed in to ${name}`);
    }
    return ok({ isRevoked: await endGrant(deps, { client, grant }) });
  };
}
