import type { FleetId } from '@aeolus-fleet/common';

import type { OAuthSecrets } from '../oauth/ports.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** Who calls: the fleet and the A2A client party its bearer names. */
export interface A2aCaller {
  fleetId: FleetId;
  party: string;
}

export type AuthenticateA2aClientRefusal = DomainError<'NOT_AN_ACTOR' | 'OUTSIDE_PARTIES_OFF'>;

export type AuthenticateA2aClient = (bearer: string) => Promise<Result<A2aCaller, AuthenticateA2aClientRefusal>>;

/**
 * Use case: whom an A2A call is for (decision 0060). The bearer an approver
 * was shown names one A2A client party, so one fleet and one proxy ship;
 * the gateway compares only its hash. While the fleet's outside parties are
 * off, every call is refused (decision 0056).
 */
export function createAuthenticateA2aClient(deps: {
  parties: Pick<PartyStore, 'findByBearer'>;
  secrets: Pick<OAuthSecrets, 'hashOf'>;
  servesOutsideParties: (fleetId: FleetId) => Promise<boolean>;
}): AuthenticateA2aClient {
  return async (bearer) => {
    const party = await deps.parties.findByBearer(deps.secrets.hashOf(bearer));
    if (party?.kind !== 'a2aClient') {
      return refuse('NOT_AN_ACTOR', 'Call with the bearer the gateway showed when your client was added');
    }
    if (!(await deps.servesOutsideParties(party.fleetId))) {
      return refuse('OUTSIDE_PARTIES_OFF', "This fleet's outside parties are off");
    }
    return ok({ fleetId: party.fleetId, party: party.name });
  };
}
