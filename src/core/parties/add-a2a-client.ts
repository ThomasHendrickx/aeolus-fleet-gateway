import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { OAuthSecrets } from '../oauth/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { APPROVING_SCOPE, EVERY_APP_SHIP_SCOPES, scopeNotHeld } from './approver.js';
import { A2A_CLIENT_SHIP_TYPE, approved, UNCOMMISSIONED, type ApprovalDeps, type ApprovePartyRefusal } from './approve-party.js';
import type { A2aClientParty } from './party.js';
import type { ShownParty } from './shown-party.js';

export type AddA2aClientRefusal = ApprovePartyRefusal | DomainError<'NOT_AN_APPROVER' | 'SCOPE_NOT_HELD'>;

export type AddA2aClient = (input: {
  actor: Actor;
  requestId: string;
  name: string;
  ownerShipId: ShipId;
  scopes: readonly string[];
}) => Promise<Result<{ party: ShownParty; bearer: string }, AddA2aClientRefusal>>;

/**
 * Use case: an actor holding gateway:approve adds an outside A2A client
 * (decision 0060). An A2A client is a machine with no browser, so nobody
 * requests it: the approver names it, its owner and its scopes, only ones
 * it holds. The gateway commissions and crews an `a2a-client` proxy ship as
 * every approval does, then shows a new bearer once and keeps only its
 * hash. The same request again, after an answer that was lost, shows a new
 * bearer in place of the first, so the approver is never left without one.
 */
export function createAddA2aClient(deps: ApprovalDeps & { secrets: Pick<OAuthSecrets, 'newSecret' | 'hashOf'> }): AddA2aClient {
  return async ({ actor, requestId, name, ownerShipId, scopes }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Adding an outside A2A client needs ${APPROVING_SCOPE}`);
    }
    const notHeld = scopeNotHeld(actor, scopes);
    if (notHeld !== undefined) {
      return refuse('SCOPE_NOT_HELD', `You may grant only scopes you hold: not ${notHeld}`);
    }
    const granted = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.has(scope));
    const { fleetId } = actor;
    const requestHash = deps.hasher.hash(JSON.stringify([requestId, name, ownerShipId, granted]));
    const party = await approved<A2aClientParty>(deps, {
      fleetId,
      type: A2A_CLIENT_SHIP_TYPE,
      scopes: granted,
      requestHash,
      owner: ownerShipId,
      party: ({ approvedAt }) => ({ fleetId, name, kind: 'a2aClient', bearerHash: null, ...UNCOMMISSIONED, requestId, requestHash, approvedAt }),
      isOwn: (earlier): earlier is A2aClientParty => earlier.kind === 'a2aClient',
    });
    if (!party.isOk) {
      return party;
    }
    const kept = await deps.parties.find(fleetId, name);
    if (kept?.kind !== 'a2aClient') {
      return refuse('PARTY_EXISTS', `A party named ${name} was approved already`);
    }
    const bearer = deps.secrets.newSecret();
    await deps.parties.save({ ...kept, bearerHash: deps.secrets.hashOf(bearer) });
    return ok({ party: party.value, bearer });
  };
}
