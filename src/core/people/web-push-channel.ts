import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { PersonShip, Wake, WakeChannel, WakeWindow, WebPush, WebPushSubscription, WebPushSubscriptions } from './ports.js';
import type { CountWaitingOn } from './read-waiting-count.js';
import { wakeJobOf, type WakeJob } from './wake-job.js';

/**
 * Web push, a channel that wakes a person (wake a person, W1, W4, W8). It is
 * on while a browser they turned it on in still takes wakes. A wake goes to
 * each such browser; it went out once one push service took it. A
 * subscription its push service says is gone takes no wake again.
 *
 * A wake for argo's inbox says only the fleet by its name and the Bridge
 * link. The person's own wake says the count of what waits on their person
 * ship, read once per wake from what waits (people.waitingCount), never the
 * record; while the fleet does not answer it, the wake did not go out. For
 * one delivery it names its sender and job and the delivery, ship and fleet
 * ids, so a client builds the item's address itself; for several, how many
 * of each job. It never says what an item says.
 */
export function createWebPushChannel(deps: {
  subscriptions: WebPushSubscriptions;
  webPush: WebPush;
  countWaiting: CountWaitingOn;
  clock: Clock;
  windowMs: number;
  bridgeUrlOf: (fleetId: FleetId) => string;
}): WakeChannel {
  const takingWakes = async ({ fleetId, shipId }: PersonShip): Promise<WebPushSubscription[]> => (await deps.subscriptions.list(fleetId, shipId)).filter(({ goneAt }) => goneAt === null);
  /** What the wake says, but the fleet's name, which each browser's subscription keeps. */
  const wakeOf = async (ship: PersonShip, window: WakeWindow): Promise<Result<(fleetName: string) => Wake, string>> => {
    const bridgeUrl = deps.bridgeUrlOf(ship.fleetId);
    if (window.waitsAt === 'argo') {
      return ok((fleetName) => ({ fleetName, bridgeUrl, waitsAt: 'argo' }));
    }
    const counted = await deps.countWaiting(ship, window.crewToken);
    if (!counted.isOk) {
      return err(`the fleet did not answer the count of what waits: ${counted.error.message}`);
    }
    const count = counted.value;
    const [only, ...others] = window.deliveries;
    if (only !== undefined && others.length === 0) {
      const named = { senderName: only.senderName, job: wakeJobOf(only.contentType), deliveryId: only.deliveryId, senderShipId: only.senderShipId, fleetId: ship.fleetId };
      return ok((fleetName) => ({ fleetName, bridgeUrl, waitsAt: 'personShip', count, ...named }));
    }
    const covered = (job: WakeJob): number => window.deliveries.filter(({ contentType }) => wakeJobOf(contentType) === job).length;
    const jobs = { question: covered('question'), step: covered('step'), alert: covered('alert'), notice: covered('notice'), message: covered('message') };
    return ok((fleetName) => ({ fleetName, bridgeUrl, waitsAt: 'personShip', count, jobs }));
  };
  return {
    name: 'web-push',
    windowMs: deps.windowMs,
    isOn: async (ship) => (await takingWakes(ship)).length > 0,
    wake: async (ship, window) => {
      const browsers = await takingWakes(ship);
      if (browsers.length === 0) {
        return err({ kind: 'unavailable', reason: 'no push service took the wake' });
      }
      const wake = await wakeOf(ship, window);
      if (!wake.isOk) {
        return err({ kind: 'unavailable', reason: wake.error });
      }
      let isTaken = false;
      for (const subscription of browsers) {
        const sent = await deps.webPush.send(subscription, wake.value(subscription.fleetName));
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
