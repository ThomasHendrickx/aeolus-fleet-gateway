import type { ShipId } from '@aeolus-fleet/common';

import type { ApprovingDeps, CheckApproving } from '../parties/check-approving.js';
import { ok, type Result } from '../shared/result.js';
import { approvedSignInParty, type ApprovedSignInPartyRefusal } from './approved-sign-in-party.js';
import type { PartyGrants } from './ports.js';
import { shownGrantOf, type OwnGrant } from './read-own-grant.js';

/** The persons a page of everyone's sign-ins shows. */
const GRANTS_PER_PAGE = 20;

/** A person's grant as an approver sees it: whose, and what the person sees of it themselves. */
export type PersonGrant = { readonly personShipId: ShipId } & Exclude<OwnGrant, { state: 'notSignedIn' }>;

export type ListGrants = (
  input: Parameters<CheckApproving>[0] & { /** The last person ship of the page before; none for the first page. */ after: ShipId | null },
) => Promise<Result<{ grants: PersonGrant[]; /** Where the next page starts; none on the last page. */ next: ShipId | null }, ApprovedSignInPartyRefusal>>;

/**
 * Use case: an actor holding gateway:approve within manage reach of an
 * outside MCP server's proxy ship lists every person's sign-in to it
 * (decision 0067, Q12), a page at a time by person ship, never a token, so
 * it sees whose grant to remove.
 */
export function createListGrants(deps: ApprovingDeps & { grants: Pick<PartyGrants, 'ofParty'> }): ListGrants {
  return async ({ after, ...asked }) => {
    const approved = await approvedSignInParty(deps, asked);
    if (!approved.isOk) {
      return approved;
    }
    // One more than a page tells whether a next page follows.
    const held = await deps.grants.ofParty(asked.actor.fleetId, { party: approved.value.name, after, limit: GRANTS_PER_PAGE + 1 });
    const page = held.slice(0, GRANTS_PER_PAGE);
    return ok({
      grants: page.map((grant) => ({ personShipId: grant.personShipId, ...shownGrantOf(grant) })),
      next: held.length > GRANTS_PER_PAGE ? (page.at(-1)?.personShipId ?? null) : null,
    });
  };
}
