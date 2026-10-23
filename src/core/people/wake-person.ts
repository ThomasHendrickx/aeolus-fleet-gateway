import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { INBOX_LIST_MAX } from './read-inbox.js';
import type { FocusedPages, PersonDelivery, PersonShip, PersonShipDoor, PersonWakes, WakeChannel, WebPush, WebPushSubscriptions } from './ports.js';

/**
 * How a wake came out: settled (handed, or nothing to hand while no channel
 * is on), the channel's window still open until then, or failed, to be
 * tried again.
 */
export type WakeOutcome = { readonly kind: 'settled' } | { readonly kind: 'windowOpen'; readonly endsAt: Date } | { readonly kind: 'failed' };

export type WakePerson = (ship: PersonShip, crewToken: string) => Promise<WakeOutcome>;

/** The hand-over number of a delivery never handed before (decision 0040). */
const FIRST_HAND_OVER = 1;

const SETTLED: WakeOutcome = { kind: 'settled' };
const FAILED: WakeOutcome = { kind: 'failed' };

/**
 * Use case: the waiter of a person ship wakes its person for the deliveries
 * never handed yet (wake a person, W3, W4, W6, W8, W10). While a page of
 * theirs is in focus, the page shows them: each is handed through it and no
 * wake goes out. Otherwise web push, if they turned it on, sends one wake to
 * each browser, at most once per window, and each delivery it covers is
 * handed through it. A wake carries only the fleet's name and the overview
 * link. With no channel on, they stay received for the person's next look.
 */
export function createWakePerson(deps: {
  door: Pick<PersonShipDoor, 'pushReceive' | 'handed'>;
  subscriptions: WebPushSubscriptions;
  wakes: PersonWakes;
  focused: FocusedPages;
  webPush: WebPush;
  clock: Clock;
  /** Each channel's window: it sends at most one wake within it (W10). */
  windowMs: { readonly webPush: number };
  /** How long a page counts in focus since it was last seen so. */
  focusFreshMs: number;
  overviewUrlOf: (fleetId: FleetId) => string;
}): WakePerson {
  const handAll = async (crewToken: string, handed: { deliveries: readonly PersonDelivery[]; channel: WakeChannel }): Promise<WakeOutcome> => {
    for (const { deliveryId } of handed.deliveries) {
      const answered = await deps.door.handed(crewToken, { deliveryId, handOverNumber: FIRST_HAND_OVER, channel: handed.channel });
      if (!answered.isOk) {
        return FAILED;
      }
    }
    return SETTLED;
  };

  return async (ship, crewToken) => {
    const taken = await deps.door.pushReceive(crewToken, { max: INBOX_LIST_MAX });
    if (!taken.isOk) {
      return FAILED;
    }
    const fresh = taken.value.filter(({ handOverNumber }) => handOverNumber === null);
    if (fresh.length === 0) {
      return SETTLED;
    }
    const now = deps.clock.now();
    if (await deps.focused.isAnyInFocus(ship, new Date(now.getTime() - deps.focusFreshMs))) {
      return handAll(crewToken, { deliveries: fresh, channel: 'page' });
    }
    const browsers = (await deps.subscriptions.list(ship.fleetId, ship.shipId)).filter(({ goneAt }) => goneAt === null);
    if (browsers.length === 0) {
      return SETTLED;
    }
    const lastWokenAt = await deps.wakes.lastWokenAt(ship, 'web-push');
    if (lastWokenAt !== undefined && now.getTime() < lastWokenAt.getTime() + deps.windowMs.webPush) {
      return { kind: 'windowOpen', endsAt: new Date(lastWokenAt.getTime() + deps.windowMs.webPush) };
    }
    const overviewUrl = deps.overviewUrlOf(ship.fleetId);
    let isSentToAny = false;
    let hasFailed = false;
    for (const subscription of browsers) {
      const sent = await deps.webPush.send(subscription, { fleetName: subscription.fleetName, overviewUrl });
      switch (sent) {
        case 'sent':
          isSentToAny = true;
          break;
        case 'gone':
          await deps.subscriptions.markGone(ship.fleetId, { shipId: ship.shipId, endpoint: subscription.endpoint, goneAt: now });
          break;
        case 'failed':
          hasFailed = true;
          break;
      }
    }
    if (!isSentToAny) {
      return hasFailed ? FAILED : SETTLED;
    }
    // The window starts with the wake, before the hand-overs: a wake that went out is not sent again inside it.
    await deps.wakes.record(ship, { channel: 'web-push', at: now });
    return handAll(crewToken, { deliveries: fresh, channel: 'web-push' });
  };
}
