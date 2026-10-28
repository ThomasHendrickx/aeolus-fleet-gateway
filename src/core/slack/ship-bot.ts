import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackShips } from './ports.js';
import type { SlackApp } from './slack-app.js';

export type ShipBotRefusal = DomainError<'NO_SUCH_BOT' | 'NOT_REACHABLE' | 'FLEET_UNAVAILABLE'>;

/**
 * A ship's bot in the actor's fleet, once the fleet, asked as the actor,
 * answers that the actor manages the ship (B6). The gateway's own bot is no
 * ship's.
 */
export async function managedShipBot(
  deps: { apps: Pick<SlackApps, 'find'>; ships: Pick<SlackShips, 'read' | 'checkManage'>; credentialOf: CredentialOf },
  asked: { actor: Actor; as: ActorCredential; appId: string },
): Promise<Result<SlackApp & { shipName: string }, ShipBotRefusal>> {
  const app = await deps.apps.find(asked.actor.fleetId, asked.appId);
  if (app?.shipId === undefined || app.shipId === null) {
    return refuse('NO_SUCH_BOT', `The gateway made no ship's bot ${asked.appId} in this fleet`);
  }
  const ship = await deps.ships.read(app.fleetId, app.shipId);
  const shipName = ship.isOk ? ship.value.name : app.name;
  const credential = await deps.credentialOf(asked.actor, asked.as);
  if (!credential.isOk) {
    return credential;
  }
  const managed = await deps.ships.checkManage(credential.value, app.shipId);
  if (!managed.isOk) {
    return managed.error.code === 'UNAVAILABLE' ? refuse('FLEET_UNAVAILABLE', `The fleet did not say whether you manage ${shipName}: ${managed.error.message}`) : refuse('NOT_REACHABLE', managed.error.message);
  }
  return ok({ ...app, shipName });
}
