import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { IssuedTokens } from '../oauth/ports.js';
import type { EndPartyGrants } from '../party-grants/end-party-grants.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PartyStore, ProxyShipsAsActor } from './ports.js';

/** The scope that retires an outside party, as it retires any ship (decision 0056). */
export const RETIRING_SCOPE = 'fleet:manage';

/** The fleet's code for a ship retired already: the only conflict a retire answers. */
const RETIRED_ALREADY = 'CONFLICT';

export type RetirePartyRefusal = DomainError<'NOT_A_MANAGER' | 'NO_SUCH_PARTY' | 'RETIRE_REFUSED' | 'FLEET_UNAVAILABLE' | 'NOT_AN_ACTOR'>;

export type RetireParty = (input: { actor: Actor; as: ActorCredential; name: string }) => Promise<Result<undefined, RetirePartyRefusal>>;

/**
 * Use case: an actor holding fleet:manage retires an outside party (decision
 * 0056). Its proxy ship is retired in the fleet as the actor, so the fleet
 * checks its manage reach, and only then does the gateway forget the party
 * and revoke its client's tokens; its worker ends as the fleet ends the
 * proxy ship's crew. A server where each person signs in has every grant
 * ended and its client deleted where offered (decision 0067) before it is
 * forgotten. A proxy ship retired already is retired. A party whose
 * ship the gateway never learned asks the fleet nothing. Adding it again is
 * a new request.
 */
export function createRetireParty(deps: { parties: PartyStore; fleet: ProxyShipsAsActor; tokens: Pick<IssuedTokens, 'revokeParty'>; endPartyGrants: EndPartyGrants; credentialOf: CredentialOf }): RetireParty {
  return async ({ actor, as, name }) => {
    if (!actor.scopes.includes(RETIRING_SCOPE)) {
      return refuse('NOT_A_MANAGER', `Retiring an outside party needs ${RETIRING_SCOPE}`);
    }
    const party = await deps.parties.find(actor.fleetId, name);
    if (party === undefined) {
      return refuse('NO_SUCH_PARTY', `There is no outside party ${name}`);
    }
    if (party.proxyShipId !== null) {
      const credential = await deps.credentialOf(actor, as);
      if (!credential.isOk) {
        return credential;
      }
      const retired = await deps.fleet.retire(credential.value, { shipId: party.proxyShipId });
      if (!retired.isOk && retired.error.code === 'UNAVAILABLE') {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not retire ${name}'s proxy ship: ${retired.error.message}`);
      }
      if (!retired.isOk && retired.error.code !== RETIRED_ALREADY) {
        return refuse('RETIRE_REFUSED', retired.error.message);
      }
    }
    if (party.kind === 'mcpServer' && party.credential.kind === 'personSignIn') {
      await deps.endPartyGrants({ fleetId: actor.fleetId, name, client: party.credential.client });
    }
    await deps.parties.remove(actor.fleetId, name);
    await deps.tokens.revokeParty(actor.fleetId, name);
    return ok(undefined);
  };
}
