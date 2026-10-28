import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { McpServerParty } from '../parties/party.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';

export type SignInPartyRefusal = DomainError<'NOT_A_PERSON' | 'NO_SUCH_PARTY' | 'NO_SIGN_IN'>;

/** A person acting on their own sign-in to a party, and the party's client. */
export interface SignInParty {
  readonly party: McpServerParty;
  readonly client: SignInClient;
  readonly accountId: string;
  readonly personShipId: ShipId;
}

/**
 * The party an account signs in to for itself (decision 0067, Q16): only an
 * account with a person ship in the fleet, and only an outside MCP server
 * where each person signs in.
 */
export async function signInPartyOf(parties: Pick<PartyStore, 'find'>, asked: { actor: Actor; name: string }): Promise<Result<SignInParty, SignInPartyRefusal>> {
  const { actor, name } = asked;
  if (actor.kind !== 'account' || actor.personShipId === null) {
    return refuse('NOT_A_PERSON', 'Only a person signs in to an outside server, and your account has no person ship in this fleet');
  }
  const party = await parties.find(actor.fleetId, name);
  if (party?.kind !== 'mcpServer') {
    return refuse('NO_SUCH_PARTY', `There is no outside MCP server ${name}`);
  }
  if (party.credential.kind !== 'personSignIn') {
    return refuse('NO_SIGN_IN', `Nobody signs in to ${name} for themselves: the gateway calls it with its own credential`);
  }
  return ok({ party, client: party.credential.client, accountId: actor.accountId, personShipId: actor.personShipId });
}
