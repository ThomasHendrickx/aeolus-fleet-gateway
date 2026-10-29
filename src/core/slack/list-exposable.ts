import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ProxyShipKinds, SlackApps, SlackShips } from './ports.js';

export type ListExposable = (input: { actor: Actor; as: ActorCredential }) => Promise<Result<{ shipId: ShipId; name: string }[], DomainError<'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the ships Expose a ship… offers (gateway scopes 9.2, P-B3): the
 * agent ships and outside A2A agents' proxy ships the actor reads, not
 * retired and not yet bots, by name. Whether the actor manages one is the
 * fleet's to answer as it is exposed.
 */
export function createListExposable(deps: { ships: Pick<SlackShips, 'list'>; apps: Pick<SlackApps, 'all'>; proxyShips: ProxyShipKinds; credentialOf: CredentialOf }): ListExposable {
  return async ({ actor, as }) => {
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const listed = await deps.ships.list(credential.value);
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not list its ships: ${listed.error.message}`);
    }
    const exposed = new Set((await deps.apps.all(actor.fleetId)).map(({ shipId }) => shipId));
    const offered = [];
    for (const ship of listed.value) {
      if (ship.status === 'retired' || exposed.has(ship.shipId)) {
        continue;
      }
      if (ship.kind === 'agent' || (ship.kind === 'app' && (await deps.proxyShips.kindOf(actor.fleetId, ship.shipId)) === 'a2aAgent')) {
        offered.push({ shipId: ship.shipId, name: ship.name });
      }
    }
    return ok(offered.sort((first, second) => first.name.localeCompare(second.name)));
  };
}
