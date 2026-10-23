import { RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { FocusedPages, HandOverChannel, PersonShip, PersonShipDoor, PushedPersonDelivery, WakeChannel, WakeChannelName, WakesSent } from './ports.js';

/**
 * What a wake came to: nothing left to wake (settled), a wake held back
 * until the earliest window of a channel turned on ends (inWindow), or no
 * channel sent it, so it is tried again (failed).
 */
export type WakeOutcome = { readonly kind: 'settled' } | { readonly kind: 'inWindow'; readonly until: Date } | { readonly kind: 'failed' };

export type WakePerson = (ship: PersonShip, crewToken: string) => Promise<Result<WakeOutcome, FleetRefusal>>;

/**
 * Use case: wakes a person for what waits on their person ship (wake a
 * person, W3, W8). It takes the ship's deliveries with the gateway as their
 * waker; those never handed are fresh. Each channel the person turned on
 * whose window has passed sends one wake for all of them; each fresh
 * delivery is then handed no. 1, naming the first channel that went out, so
 * a delivery is woken once. A wake held back by a window, or that no
 * channel sent, hands nothing. While a page of the person is in focus, the
 * page shows what arrives (W6): each fresh delivery is handed through it
 * and no wake goes out.
 */
export function createWakePerson(deps: {
  door: Pick<PersonShipDoor, 'pushReceive' | 'handed'>;
  channels: readonly WakeChannel[];
  wakesSent: WakesSent;
  focused: FocusedPages;
  /** How long a page counts in focus since it was last seen so. */
  focusFreshMs: number;
  clock: Clock;
}): WakePerson {
  const handAll = async (crewToken: string, handed: { fresh: readonly PushedPersonDelivery[]; channel: HandOverChannel }): Promise<Result<WakeOutcome, FleetRefusal>> => {
    for (const { deliveryId } of handed.fresh) {
      const answered = await deps.door.handed(crewToken, { deliveryId, handOverNumber: 1, channel: handed.channel });
      if (!answered.isOk) {
        return answered;
      }
    }
    return ok({ kind: 'settled' });
  };

  return async (ship, crewToken) => {
    const taken = await deps.door.pushReceive(crewToken, { max: RECEIVE_MAX_UPPER_BOUND });
    if (!taken.isOk) {
      return taken;
    }
    const fresh = taken.value.filter(({ handOverNumber }) => handOverNumber === null);
    if (fresh.length === 0) {
      return ok({ kind: 'settled' });
    }
    if (await deps.focused.isAnyInFocus(ship, new Date(deps.clock.now().getTime() - deps.focusFreshMs))) {
      return handAll(crewToken, { fresh, channel: 'page' });
    }
    const turnedOn = (await Promise.all(deps.channels.map(async (channel) => ((await channel.isOn(ship)) ? [channel] : [])))).flat();
    if (turnedOn.length === 0) {
      return ok({ kind: 'settled' });
    }
    const now = deps.clock.now();
    const windows = await Promise.all(
      turnedOn.map(async (channel) => {
        const lastSentAt = await deps.wakesSent.lastSentAt(ship, channel.name);
        return { channel, endsAt: lastSentAt === undefined ? now : new Date(lastSentAt.getTime() + channel.windowMs) };
      }),
    );
    const due = windows.filter(({ endsAt }) => endsAt.getTime() <= now.getTime()).map(({ channel }) => channel);
    if (due.length === 0) {
      return ok({ kind: 'inWindow', until: new Date(Math.min(...windows.map(({ endsAt }) => endsAt.getTime()))) });
    }
    let firstOut: WakeChannelName | undefined;
    for (const channel of due) {
      const woken = await channel.wake(ship);
      if (woken.isOk) {
        await deps.wakesSent.record({ ship, channel: channel.name, sentAt: now });
        firstOut ??= channel.name;
      }
    }
    if (firstOut === undefined) {
      return ok({ kind: 'failed' });
    }
    return handAll(crewToken, { fresh, channel: firstOut });
  };
}
