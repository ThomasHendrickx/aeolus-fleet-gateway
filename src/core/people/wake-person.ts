import { RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
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
 * channel sent, hands nothing. Each channel's window is kept after the
 * hand-overs, so a gateway that stopped in between wakes again: one wake
 * more, nothing lost. A fresh delivery sent before a channel's last wake
 * that is still inside its window is one that wake covers: a hand-over the
 * fleet refused is made again through that channel, never with a second
 * wake. A channel that refused the wake for good ends the attempt, which is
 * told, as asking again cannot help. While a page of the person is in focus, the page
 * shows what arrives (W6): each fresh delivery is handed through it and no
 * wake goes out.
 */
export function createWakePerson(deps: {
  door: Pick<PersonShipDoor, 'pushReceive' | 'handed'>;
  channels: readonly WakeChannel[];
  wakesSent: WakesSent;
  focused: FocusedPages;
  /** How long a page counts in focus since it was last seen so. */
  focusFreshMs: number;
  clock: Clock;
  /** Tells that a channel refused the wake for good, so the attempt ended. */
  attemptEnded: (ended: { ship: PersonShip; channel: WakeChannelName; reason: string }) => void;
}): WakePerson {
  return async (ship, crewToken) => {
    /** Hands each fresh delivery no. 1 through the channel, up to the first refusal: that refusal, or none. */
    const handEach = async (fresh: readonly PushedPersonDelivery[], channel: HandOverChannel): Promise<FleetRefusal | undefined> => {
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
    const allFresh = taken.value.filter(({ handOverNumber }) => handOverNumber === null);
    if (allFresh.length === 0) {
      return ok({ kind: 'settled' });
    }
    if (await deps.focused.isAnyInFocus(ship, new Date(deps.clock.now().getTime() - deps.focusFreshMs))) {
      const refused = await handEach(allFresh, 'page');
      return refused === undefined ? ok({ kind: 'settled' }) : err(refused);
    }
    const turnedOn = (await Promise.all(deps.channels.map(async (channel) => ((await channel.isOn(ship)) ? [channel] : [])))).flat();
    if (turnedOn.length === 0) {
      return ok({ kind: 'settled' });
    }
    const now = deps.clock.now();
    const windows = await Promise.all(
      turnedOn.map(async (channel) => {
        const lastSentAt = await deps.wakesSent.lastSentAt(ship, channel.name);
        return { channel, lastSentAt, endsAt: lastSentAt === undefined ? now : new Date(lastSentAt.getTime() + channel.windowMs) };
      }),
    );
    // What a wake still inside its window covers was left unhanded by a refusal: hand it through that channel.
    let fresh = allFresh;
    for (const { channel, lastSentAt, endsAt } of windows) {
      if (lastSentAt === undefined || endsAt.getTime() <= now.getTime()) {
        continue;
      }
      const covered = fresh.filter(({ sentAt }) => sentAt.getTime() <= lastSentAt.getTime());
      const refused = await handEach(covered, channel.name);
      if (refused !== undefined) {
        return err(refused);
      }
      fresh = fresh.filter((delivery) => !covered.includes(delivery));
    }
    if (fresh.length === 0) {
      return ok({ kind: 'settled' });
    }
    const due = windows.filter(({ endsAt }) => endsAt.getTime() <= now.getTime()).map(({ channel }) => channel);
    if (due.length === 0) {
      return ok({ kind: 'inWindow', until: new Date(Math.min(...windows.map(({ endsAt }) => endsAt.getTime()))) });
    }
    const wentOut: WakeChannelName[] = [];
    let isRetryable = false;
    for (const channel of due) {
      const woken = await channel.wake(ship);
      if (woken.isOk) {
        wentOut.push(channel.name);
      } else if (woken.error.kind === 'refused') {
        deps.attemptEnded({ ship, channel: channel.name, reason: woken.error.reason });
      } else {
        isRetryable = true;
      }
    }
    const [firstOut] = wentOut;
    if (firstOut === undefined) {
      return ok(isRetryable ? { kind: 'failed' } : { kind: 'settled' });
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
