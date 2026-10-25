import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { err, ok } from '../shared/result.js';
import type { PersonShip, WakeChannel, WebPush, WebPushSubscription, WebPushSubscriptions } from './ports.js';

/**
 * Web push, a channel that wakes a person (wake a person, W1, W4, W8). It is
 * on while a browser they turned it on in still takes wakes. A wake goes to
 * each such browser, saying only the fleet by its name and the overview
 * link; it went out once one push service took it. A subscription its push
 * service says is gone takes no wake again.
 */
export function createWebPushChannel(deps: { subscriptions: WebPushSubscriptions; webPush: WebPush; clock: Clock; windowMs: number; overviewUrlOf: (fleetId: FleetId) => string }): WakeChannel {
  const takingWakes = async ({ fleetId, shipId }: PersonShip): Promise<WebPushSubscription[]> => (await deps.subscriptions.list(fleetId, shipId)).filter(({ goneAt }) => goneAt === null);
  return {
    name: 'web-push',
    windowMs: deps.windowMs,
    isOn: async (ship) => (await takingWakes(ship)).length > 0,
    wake: async (ship) => {
      const overviewUrl = deps.overviewUrlOf(ship.fleetId);
      let isTaken = false;
      for (const subscription of await takingWakes(ship)) {
        const sent = await deps.webPush.send(subscription, { fleetName: subscription.fleetName, overviewUrl });
        switch (sent) {
          case 'sent':
            isTaken = true;
            break;
          case 'gone':
            await deps.subscriptions.markGone(ship.fleetId, { shipId: ship.shipId, endpoint: subscription.endpoint, goneAt: deps.clock.now() });
            break;
          case 'failed':
            break;
        }
      }
      return isTaken ? ok(undefined) : err({ kind: 'unavailable', reason: 'no push service took the wake' });
    },
  };
}
