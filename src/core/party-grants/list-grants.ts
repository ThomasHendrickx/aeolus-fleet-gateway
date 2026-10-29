import type { ShipId } from '@aeolus-fleet/common';

import type { ApprovingDeps, CheckApproving } from '../parties/check-approving.js';
import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { approvedSignInParty, type ApprovedSignInPartyRefusal } from './approved-sign-in-party.js';
import type { PartyGrants, ShipNames } from './ports.js';
import { shownGrantOf, type OwnGrant } from './read-own-grant.js';

/** The persons a page of everyone's sign-ins shows. */
const GRANTS_PER_PAGE = 20;

/** A person's grant as an approver sees it: whose, by their person ship and its name where the fleet answers one, whether it is the approver's own, and what the person sees of it themselves. */
export type PersonGrant = { readonly personShipId: ShipId; readonly personName: string | null; readonly isYours: boolean } & Exclude<OwnGrant, { state: 'notSignedIn' }>;

export type ListGrants = (
  input: Parameters<CheckApproving>[0] & { /** The last person ship of the page before; none for the first page. */ after: ShipId | null },
) => Promise<Result<{ grants: PersonGrant[]; /** Where the next page starts; none on the last page. */ next: ShipId | null }, ApprovedSignInPartyRefusal>>;

/**
 * Use case: an actor holding gateway:approve within manage reach of an
 * outside MCP server's proxy ship lists every person's sign-in to it
 * (decision 0067, Q12), a page at a time by person ship, never a token, so
 * it sees whose grant to remove, each named by its person ship's name.
 */
export function createListGrants(deps: ApprovingDeps & { grants: Pick<PartyGrants, 'ofParty'>; ships: ShipNames }): ListGrants {
  return async ({ after, ...asked }) => {
    const approved = await approvedSignInParty(deps, asked);
    if (!approved.isOk) {
      return approved;
    }
    // One more than a page tells whether a next page follows.
    const held = await deps.grants.ofParty(asked.actor.fleetId, { party: approved.value.name, after, limit: GRANTS_PER_PAGE + 1 });
    const page = held.slice(0, GRANTS_PER_PAGE);
    // The page's person ships named in one read, so a page costs one fleet call however many it shows.
    const names = page.length === 0 ? ok(new Map<ShipId, string>()) : await deps.ships.namesOf(approved.value.credential, page.map(({ personShipId }) => personShipId));
    if (!names.isOk) {
      return refuse('FLEET_UNAVAILABLE', 'The fleet did not answer: try again in a moment.');
    }
    const yours = asked.actor.kind === 'account' ? asked.actor.personShipId : null;
    return ok({
      grants: page.map((grant) => ({ personShipId: grant.personShipId, personName: names.value.get(grant.personShipId) ?? null, isYours: grant.personShipId === yours, ...shownGrantOf(grant) })),
      next: held.length > GRANTS_PER_PAGE ? (page.at(-1)?.personShipId ?? null) : null,
    });
  };
}
