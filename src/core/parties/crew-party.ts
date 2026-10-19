import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { shownPartyOf, type ShownParty } from './shown-party.js';
import type { Party } from './party.js';
import type { PartyStore, ProxyShipDoor } from './ports.js';

export type CrewParty = (input: { operatorFleetId: FleetId; name: string; secret: string }) => Promise<
  Result<ShownParty, DomainError<'NO_SUCH_PARTY' | 'NOT_AWAITING_CREW' | 'SECRET_REFUSED'>>
>;

/**
 * Use case: argo hands over a new secret for a party's proxy ship that awaits
 * crew, taken from a new starting prompt in the console: the commission's
 * answer was lost, and its secret with it, and the gateway's ship may not ask
 * for a new one (orchestrator-1 on aeolus-fleet#876, Q6). The gateway crews
 * the ship with it and keeps the crew token; the secret is never kept.
 */
export function createCrewParty(deps: { parties: PartyStore; door: ProxyShipDoor }): CrewParty {
  return async ({ operatorFleetId, name, secret }) => {
    const party = await deps.parties.find(operatorFleetId, name);
    if (!party) {
      return refuse('NO_SUCH_PARTY', `No party named ${name}`);
    }
    if (party.state !== 'awaitingCrew' || party.proxyShipId === null) {
      return refuse('NOT_AWAITING_CREW', `The proxy ship of ${name} does not await crew`);
    }
    const registered = await deps.door.register({ shipId: party.proxyShipId, secret });
    if (!registered.isOk) {
      return refuse('SECRET_REFUSED', `The fleet refused the secret: ${registered.error.message}`);
    }
    const crewed: Party = { ...party, state: 'crewed', secret: null, crewToken: registered.value.crewToken };
    await deps.parties.save(crewed);
    return ok(shownPartyOf(crewed));
  };
}
