import type { FleetId } from '@aeolus-fleet/common';

import type { PersonParty } from '../parties/party.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { inboxEntryOf, type InboxEntry } from './inbox-entry.js';
import type { PersonShipDoor } from './ports.js';

/** The most deliveries an inbox lists at once: as many as one receive takes. */
export const INBOX_LIST_MAX = 10;

/** Who calls from an MCP client: the fleet and the party its token names. */
export interface PersonCaller {
  readonly fleetId: FleetId;
  readonly party: string;
}

export type ReadInbox = (caller: PersonCaller) => Promise<Result<{ waiting: number; deliveries: InboxEntry[] }, DomainError<'NOT_A_PERSON' | 'FLEET_UNAVAILABLE'>>>;

/** The caller's person party, crewed by the gateway, with its crew token. */
export async function crewedPersonOf(parties: PartyStore, caller: PersonCaller): Promise<(PersonParty & { crewToken: string }) | undefined> {
  const party = await parties.find(caller.fleetId, caller.party);
  return party?.kind === 'person' && party.state === 'crewed' && party.crewToken !== null ? { ...party, crewToken: party.crewToken } : undefined;
}

/**
 * Use case: a person reads their own ship's inbox (Q20): what waits, by
 * titles only. The gateway, as the ship's crew, takes the waiting deliveries
 * as received, its own held ones again first, so a delivery listed is listed
 * again until the person deals with it. It asks how many wait first, so the
 * person is never kept waiting while none does.
 */
export function createReadInbox(deps: { parties: PartyStore; door: PersonShipDoor }): ReadInbox {
  return async (caller) => {
    const person = await crewedPersonOf(deps.parties, caller);
    if (!person) {
      return refuse('NOT_A_PERSON', `The party ${caller.party} is no person's ship the gateway crews`);
    }
    const counted = await deps.door.inbox(person.crewToken);
    if (!counted.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the inbox: ${counted.error.message}`);
    }
    if (counted.value.waiting === 0) {
      return ok({ waiting: 0, deliveries: [] });
    }
    const taken = await deps.door.pushReceive(person.crewToken, { max: INBOX_LIST_MAX });
    if (!taken.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the inbox: ${taken.error.message}`);
    }
    return ok({ waiting: counted.value.waiting, deliveries: taken.value.map(inboxEntryOf) });
  };
}
