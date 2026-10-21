import type { ConnectionStore } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { AccountTokenOf } from '../sign-in/account-token.js';
import type { Actor } from './authenticate-actor.js';

/**
 * What the gateway calls the fleet with, so the fleet answers as the actor
 * (decision 0057): argo's or a viewer's console session cookie, a ship's own
 * crew token, or an account's token with the crew token of the gateway's
 * ship presenting it.
 */
export interface ActorCredential {
  cookie?: string;
  crewToken?: string;
  accountToken?: string;
}

export type CredentialOf = (actor: Actor, sent: ActorCredential) => Promise<Result<ActorCredential, DomainError<'NOT_AN_ACTOR' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the credential to call the fleet with as the actor. A ship, argo
 * or a viewer sent its own, which goes on as it came. An account on the
 * gateway's pages sent only its page session: its grant's account token goes,
 * refreshed when about to end, presented by the gateway's ship of its fleet;
 * signed in with the shared sign-in, the token pagasae exchanged it for goes.
 */
export function createCredentialOf(deps: { connections: Pick<ConnectionStore, 'find'>; accountTokenOf: AccountTokenOf }): CredentialOf {
  return async (actor, sent) => {
    if (actor.kind !== 'account') {
      return ok(sent);
    }
    const gateway = await deps.connections.find(actor.fleetId);
    if (gateway === undefined) {
      return refuse('FLEET_UNAVAILABLE', 'The gateway is not connected to your fleet');
    }
    if (actor.grantId === null) {
      return actor.accountToken === undefined ? refuse('NOT_AN_ACTOR', 'Your sign-in ended: sign in again') : ok({ crewToken: gateway.crewToken, accountToken: actor.accountToken });
    }
    const token = await deps.accountTokenOf({ fleetId: actor.fleetId, grantId: actor.grantId });
    if (!token.isOk) {
      return token.error.kind === 'signedOut' ? refuse('NOT_AN_ACTOR', 'Your sign-in ended: sign in again') : refuse('FLEET_UNAVAILABLE', 'pagasae did not answer, so your account token could not be renewed');
    }
    return ok({ crewToken: gateway.crewToken, accountToken: token.value.accountToken });
  };
}
