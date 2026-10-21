import type { ConnectionStore } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
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

export type CredentialOf = (actor: Actor, sent: ActorCredential) => Promise<Result<ActorCredential, DomainError<'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the credential to call the fleet with as the actor. A ship, argo
 * or a viewer sent its own, which goes on as it came. An account signed in
 * with the shared sign-in sent only that: the token pagasae exchanged it for
 * goes, presented by the gateway's ship of its fleet.
 */
export function createCredentialOf(deps: { connections: Pick<ConnectionStore, 'find'> }): CredentialOf {
  return async (actor, sent) => {
    if (actor.kind !== 'account') {
      return ok(sent);
    }
    const gateway = await deps.connections.find(actor.fleetId);
    if (gateway === undefined) {
      return refuse('FLEET_UNAVAILABLE', 'The gateway is not connected to your fleet');
    }
    return ok({ crewToken: gateway.crewToken, accountToken: actor.accountToken });
  };
}
