import type { PartyStore } from '../parties/ports.js';
import type { PersonCaller } from './read-inbox.js';

export type IsPerson = (caller: PersonCaller) => Promise<boolean>;

/** Use case: whether an MCP client's party is a person's ship, served the person's tools instead of the fleet's (Q20). */
export function createIsPerson(deps: { parties: PartyStore }): IsPerson {
  return async ({ fleetId, party }) => (await deps.parties.find(fleetId, party))?.kind === 'person';
}
