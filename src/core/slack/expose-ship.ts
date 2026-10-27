import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { SLACK_SCOPE } from './connect-slack.js';
import type { ProxyShipKinds, SlackApps, SlackShips, SlackTooling } from './ports.js';
import { shipBotDescription, type SlackAddresses } from './slack-app.js';
import { slackUnavailableMessage, type TakeAccessToken } from './take-access-token.js';

export type ExposeShipRefusal = DomainError<
  'SLACK_SCOPE_NOT_HELD' | 'SLACK_NOT_CONNECTED' | 'SLACK_TOKEN_REFUSED' | 'SLACK_UNAVAILABLE' | 'CONFLICT' | 'NOT_EXPOSABLE' | 'NOT_REACHABLE' | 'FLEET_UNAVAILABLE'
>;

export type ExposeShip = (input: { actor: Actor; as: ActorCredential; shipId: ShipId }) => Promise<Result<{ appId: string }, ExposeShipRefusal>>;

/**
 * Use case: an actor holding gateway:slack, within manage reach of the ship
 * (B6), exposes it as a Slack bot (gateway scopes 9.2): an agent ship or an
 * outside A2A agent's proxy ship, which take a message and answer (P-B3).
 * The gateway makes the ship's app from a manifest, named after the ship,
 * its statement's summary as the description, and keeps it by the ship's
 * id, never its name (L20). Install follows.
 */
export function createExposeShip(deps: {
  slack: Pick<SlackTooling, 'makeApp'>;
  apps: Pick<SlackApps, 'ofShip' | 'save'>;
  ships: SlackShips;
  proxyShips: ProxyShipKinds;
  takeAccessToken: TakeAccessToken;
  credentialOf: CredentialOf;
  clock: Clock;
  addresses: Pick<SlackAddresses, 'installRedirectUrl' | 'eventsUrl'>;
}): ExposeShip {
  return async ({ actor, as, shipId }) => {
    if (!actor.scopes.includes(SLACK_SCOPE)) {
      return refuse('SLACK_SCOPE_NOT_HELD', `Exposing a ship as a Slack bot needs ${SLACK_SCOPE}`);
    }
    const { fleetId } = actor;
    const ship = await deps.ships.read(fleetId, shipId);
    if (!ship.isOk) {
      return ship.error.code === 'UNAVAILABLE' ? refuse('FLEET_UNAVAILABLE', `The fleet did not answer: ${ship.error.message}`) : refuse('NOT_EXPOSABLE', `The fleet has no ship ${shipId}`);
    }
    const { name } = ship.value;
    if ((await deps.apps.ofShip(fleetId, shipId)) !== undefined) {
      return refuse('CONFLICT', `${name} is a Slack bot already`);
    }
    if (ship.value.status === 'retired') {
      return refuse('NOT_EXPOSABLE', `${name} was retired`);
    }
    const proxyKind = await deps.proxyShips.kindOf(fleetId, shipId);
    if (proxyKind === 'mcpServer') {
      return refuse('NOT_EXPOSABLE', `${name} is an outside MCP server's proxy ship: it takes tool calls, not a person's words. Expose an agent ship that uses its tools`);
    }
    if (ship.value.kind !== 'agent' && proxyKind !== 'a2aAgent') {
      return refuse('NOT_EXPOSABLE', `${name} is no agent ship nor an outside A2A agent's proxy ship`);
    }
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const managed = await deps.ships.checkManage(credential.value, shipId);
    if (!managed.isOk) {
      return managed.error.code === 'UNAVAILABLE' ? refuse('FLEET_UNAVAILABLE', `The fleet did not say whether you manage ${name}: ${managed.error.message}`) : refuse('NOT_REACHABLE', managed.error.message);
    }
    const accessToken = await deps.takeAccessToken(fleetId);
    if (!accessToken.isOk) {
      return accessToken;
    }
    const description = shipBotDescription(ship.value, deps.addresses);
    const made = await deps.slack.makeApp(accessToken.value, description);
    if (!made.isOk) {
      return refuse('SLACK_UNAVAILABLE', made.error.kind === 'refused' ? `Slack did not make ${name}'s bot (${made.error.error})` : slackUnavailableMessage(made.error));
    }
    await deps.apps.save({ fleetId, shipId, ...made.value, name: description.name, madeAt: deps.clock.now(), installStartedAt: null, bot: null, removedInSlackAt: null });
    return ok({ appId: made.value.appId });
  };
}
