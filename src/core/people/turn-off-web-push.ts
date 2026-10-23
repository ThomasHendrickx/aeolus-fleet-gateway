import type { PersonShip, WebPushSubscriptions } from './ports.js';

export type TurnOffWebPush = (input: { ship: PersonShip; endpoint: string }) => Promise<void>;

/** Use case: a person removes a browser they turned web push on in (wake a person, W8): it takes no wake again. */
export function createTurnOffWebPush(deps: { subscriptions: WebPushSubscriptions }): TurnOffWebPush {
  return async ({ ship, endpoint }) => {
    await deps.subscriptions.remove(ship.fleetId, { shipId: ship.shipId, endpoint });
  };
}
