import type { FleetId } from '@aeolus-fleet/common';

import { issueCode } from '../oauth/issue-code.js';
import type { AuthorizationCodes, OAuthSecrets } from '../oauth/ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from '../oauth/read-authorization.js';
import type { PersonParty } from '../parties/party.js';
import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SignedInPerson } from './sign-in.js';

/** Why a person who signed in got no code, beside the request's own refusals: argo gave them no ship of the fleet. */
export type PersonRefusal = AuthorizationRefusal | { readonly kind: 'notMapped'; readonly message: string };

export type AuthorizePerson = (input: { fleetId: FleetId; person: SignedInPerson; request: Readonly<Record<string, string>> }) => Promise<Result<{ redirectTo: string }, PersonRefusal>>;

/**
 * Use case: a person who signed in at the fleet's identity provider is sent
 * back to their MCP client with a code for their own ship (Q26 (a)). A
 * person bound to a sign-in is known by its issuer and subject alone, as
 * an email can change hands; one not bound yet is known by the verified
 * email argo mapped them by, and bound to this sign-in, once. The client's
 * request is read again, so nothing changed since the sign-in started is
 * taken.
 */
export function createAuthorizePerson(deps: {
  readAuthorization: ReadAuthorization;
  parties: PartyStore;
  codes: AuthorizationCodes;
  secrets: OAuthSecrets;
  clock: Clock;
  issuer: string;
}): AuthorizePerson {
  const notMapped = (person: SignedInPerson) => err({ kind: 'notMapped' as const, message: `argo has not given ${person.email ?? person.subject} a ship of this fleet` });

  /** The person argo mapped who signed in: bound already, or bound now. */
  const mappedPerson = async (fleetId: FleetId, person: SignedInPerson): Promise<PersonParty | undefined> => {
    const signIn = { issuer: person.issuer, subject: person.subject };
    const bound = await deps.parties.findPersonBySignIn(fleetId, signIn);
    if (bound || person.email === null) {
      return bound;
    }
    const mapped = await deps.parties.findPersonByEmail(fleetId, person.email.toLowerCase());
    if (!mapped || !(await deps.parties.bindPerson(fleetId, { name: mapped.name, ...signIn }))) {
      return undefined;
    }
    return { ...mapped, ...signIn };
  };

  return async ({ fleetId, person, request }) => {
    const read = await deps.readAuthorization(request);
    if (!read.isOk) {
      return read;
    }
    const authorization = read.value;
    if (authorization.fleetId !== fleetId) {
      return err({ kind: 'invalidClient', message: `${authorization.clientName} asks for another fleet's MCP endpoint than the one you signed in for` });
    }
    const party = await mappedPerson(fleetId, person);
    if (!party) {
      return notMapped(person);
    }
    return ok({ redirectTo: await issueCode(deps, { authorization, party: party.name }) });
  };
}
