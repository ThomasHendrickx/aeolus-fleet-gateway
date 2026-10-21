import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { PersonCrews } from './ports.js';

/** Who calls from a signed-in person's MCP client: the account grant its token stands for. */
export interface GrantCaller {
  readonly fleetId: FleetId;
  readonly grantId: string;
}

/**
 * Who calls as a signed-in person: from their MCP client, the account grant
 * its token stands for; from the web app's pages, with the shared sign-in
 * (header design H5), the account token pagasae exchanged it for.
 */
export type PersonCaller =
  | GrantCaller
  | { readonly fleetId: FleetId; readonly signedIn: { readonly accountToken: string; readonly personShipId: ShipId | null } };

/** The person ship the gateway crews for the caller, and its crew token. */
export interface PersonCrewToken {
  readonly shipId: ShipId;
  readonly crewToken: string;
}

export type PersonCrewError = DomainError<'NOT_A_PERSON' | 'SIGNED_OUT' | 'FLEET_UNAVAILABLE'>;

/** The fleet's codes for a crew token that no longer works: its lease ended, or it is unknown. */
const ENDED_CREW = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

/** The crew of the caller's person ship, or why there is none, said so the person's model can tell them. */
export async function personCrewOf(crewPersonShip: CrewPersonShip, caller: PersonCaller): Promise<Result<PersonCrewToken, PersonCrewError>> {
  const crewed = await crewPersonShip(caller);
  if (crewed.isOk) {
    return crewed;
  }
  switch (crewed.error.kind) {
    case 'noPersonShip':
      return refuse('NOT_A_PERSON', 'You have no person ship in this fleet: your rights there do not let you message');
    case 'signedOut':
      return refuse('SIGNED_OUT', 'Your sign-in ended: sign in again from your MCP client');
    case 'pagasaeUnavailable':
      return refuse('FLEET_UNAVAILABLE', 'The sign-in service did not answer: try again');
    case 'notConnected':
      return refuse('FLEET_UNAVAILABLE', 'The gateway is not connected to this fleet now: try again later');
    case 'fleetRefused':
      return refuse('FLEET_UNAVAILABLE', `The fleet did not crew your person ship: ${crewed.error.message}`);
  }
}

/**
 * Makes a call as the crew of the caller's person ship. A crew that no
 * longer works, as when its lease ended, is forgotten and the ship crewed
 * again, once, so the person never deals with a lease.
 */
export async function asPersonCrew<T>(
  deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews },
  call: { caller: PersonCaller; run: (crew: PersonCrewToken) => Promise<Result<T, FleetRefusal>> },
): Promise<Result<{ crew: PersonCrewToken; value: T }, PersonCrewError>> {
  const { caller, run } = call;
  const crew = await personCrewOf(deps.crewPersonShip, caller);
  if (!crew.isOk) {
    return crew;
  }
  const answered = await run(crew.value);
  if (answered.isOk) {
    return ok({ crew: crew.value, value: answered.value });
  }
  if (!ENDED_CREW.has(answered.error.code)) {
    return fleetDidNotAnswer(answered.error);
  }
  await deps.crews.drop(caller.fleetId, crew.value.shipId);
  const again = await personCrewOf(deps.crewPersonShip, caller);
  if (!again.isOk) {
    return again;
  }
  const retried = await run(again.value);
  return retried.isOk ? ok({ crew: again.value, value: retried.value }) : fleetDidNotAnswer(retried.error);
}

function fleetDidNotAnswer(refusal: FleetRefusal): Result<never, PersonCrewError> {
  return refuse('FLEET_UNAVAILABLE', `The fleet did not answer: ${refusal.message}`);
}

/**
 * A fleet call whose refusal the caller says itself, as a value: only a crew
 * that no longer works stays a refusal, so asPersonCrew crews again.
 */
export async function withOwnRefusal<T>(called: Promise<Result<T, FleetRefusal>>): Promise<Result<Result<T, FleetRefusal>, FleetRefusal>> {
  const answered = await called;
  return !answered.isOk && ENDED_CREW.has(answered.error.code) ? answered : ok(answered);
}
