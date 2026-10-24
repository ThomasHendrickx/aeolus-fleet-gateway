import { RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { PersonShip, PersonShipDoor, PushedPersonDelivery, WakeChannel, WakeChannelName, WakesSent } from './ports.js';

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
 * channel sent, hands nothing. Each channel's window is kept after the
 * hand-overs, so a gateway that stopped in between wakes again: one wake
 * more, nothing lost.
 */
export function createWakePerson(deps: {
  door: Pick<PersonShipDoor, 'pushReceive' | 'handed'>;
  channels: readonly WakeChannel[];
  wakesSent: WakesSent;
  clock: Clock;
}): WakePerson {
  return async (ship, crewToken) => {
    /** Hands each fresh delivery no. 1 through the channel, up to the first refusal: that refusal, or none. */
    const handEach = async (fresh: readonly PushedPersonDelivery[], channel: WakeChannelName): Promise<FleetRefusal | undefined> => {
      for (const { deliveryId } of fresh) {
        const handed = await deps.door.handed(crewToken, { deliveryId, handOverNumber: 1, channel });
        if (!handed.isOk) {
          return handed.error;
        }
      }
      return undefined;
    };
    const taken = await deps.door.pushReceive(crewToken, { max: RECEIVE_MAX_UPPER_BOUND });
    if (!taken.isOk) {
      return taken;
    }
    const fresh = taken.value.filter(({ handOverNumber }) => handOverNumber === null);
    if (fresh.length === 0) {
      return ok({ kind: 'settled' });
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
    const wentOut: WakeChannelName[] = [];
    for (const channel of due) {
      if ((await channel.wake(ship)).isOk) {
        wentOut.push(channel.name);
      }
    }
    const [firstOut] = wentOut;
    if (firstOut === undefined) {
      return ok({ kind: 'failed' });
    }
    const refused = await handEach(fresh, firstOut);
    // The window is kept only after the hand-overs: a gateway that stopped in between wakes again, as the design says. A refusal keeps it, so no second email follows at once.
    for (const channel of wentOut) {
      await deps.wakesSent.record({ ship, channel, sentAt: now });
    }
    if (refused !== undefined) {
      return err(refused);
    }
    return ok({ kind: 'settled' });
  };
}
