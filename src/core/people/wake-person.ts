import { RECEIVE_MAX_UPPER_BOUND, type DeliveryId } from "@aeolus-fleet/common";

import type { ConnectionStore, FleetRefusal } from "../connection/ports.js";
import type { Clock } from "../shared/clock.js";
import { err, ok, type Result } from "../shared/result.js";
import type { RoutingDefaults, Routing, Routes } from "./routing.js";
import { ownStepsInBridgeOnly, routingOf } from "./routing.js";
import { quietSpellAt, type QuietHoursStore } from "./quiet-hours.js";
import { withQuietShips, type QuietShips } from "./quiet-ships.js";
import type {
  FocusedPages,
  HandOverChannel,
  PersonShip,
  PersonShipDoor,
  PushedPersonDelivery,
  ShownElsewhere,
  WakeChannel,
  WakeChannelName,
  WakesSent,
} from "./ports.js";

/**
 * What a wake came to: nothing left to wake (settled), a wake held back
 * until the earliest window of a channel turned on ends (inWindow), or no
 * channel sent it, so it is tried again (failed).
 */
export type WakeOutcome =
  | { readonly kind: "settled" }
  | { readonly kind: "inWindow"; readonly until: Date }
  | { readonly kind: "failed" };

export type WakePerson = (
  ship: PersonShip,
  crewToken: string,
) => Promise<Result<WakeOutcome, FleetRefusal>>;

/**
 * Use case: wakes a person for what waits on their person ship (wake a
 * person, W3, W8). It takes the ship's deliveries with the gateway as their
 * waker, leaving the handed ones out so ten held deliveries never shut a new
 * one out; those never handed are fresh. Where each job shows is read anew
 * at every wake (Bridge, section 8), so a change applies at once. Each
 * channel whose window has passed sends one wake for the fresh deliveries
 * of the jobs on for it that arrived since it was turned on (CC20); each is
 * then handed no. 1, naming the first of its channels that went out, so a
 * delivery is woken once (CC13). One no channel shows waits in Bridge,
 * unhanded. A wake held back by a window, or that no channel sent, hands
 * nothing, and while a delivery only a failing channel shows is left, the
 * wake counts as failed. Each channel's window is kept after the
 * hand-overs, so a gateway that stopped in between wakes again: one wake
 * more, nothing lost. A fresh delivery sent before a channel's last wake
 * that is still inside its window is one that wake covers: a hand-over the
 * fleet refused is made again through that channel, never with a second
 * wake. A channel that refused the wake for good ends the attempt, which is
 * told, as asking again cannot help; while another channel's wake fails and is
 * tried again, that channel is not asked again. While a page of the person is in focus, the page
 * shows what arrives (W6): each fresh delivery is handed through it and no
 * wake goes out. Before all that, a place beyond the pages that shows
 * deliveries itself, as Slack does for a linked person, shows what the
 * person routed there, even while a page is in focus; nothing wakes for those
 * (gateway scopes 9.5 step 5). It is asked at every wake, fresh deliveries
 * or none, so what it left unfinished is finished, and while anything is
 * left the wake counts as failed, so it is tried again. The person's
 * preferences are read anew at every wake too: a quiet ship's deliveries
 * wake nobody and wait unhanded, and during quiet hours no wake goes out;
 * the wake is held back until they end or a channel's window passes,
 * whichever comes first, so turning them off applies by the next window.
 */
export function createWakePerson(deps: {
  door: Pick<PersonShipDoor, "pushReceive" | "handed">;
  /** The gateway's connection, whose ship sends the gateway's own steps. */
  connections: Pick<ConnectionStore, "binding">;
  /** Slack, where the person linked it; none where nothing beyond the pages shows deliveries. */
  shownElsewhere?: ShownElsewhere;
  channels: readonly WakeChannel[];
  /** Where each person routed each job (Bridge, section 8), and the defaults where they chose nothing. */
  routes: Routes;
  defaults: RoutingDefaults;
  /** The person's quiet hours and quiet ships (preferences design). */
  quietHours: Pick<QuietHoursStore, "find">;
  quietShips: Pick<QuietShips, "among">;
  wakesSent: WakesSent;
  focused: FocusedPages;
  /** How long a page counts in focus since it was last seen so. */
  focusFreshMs: number;
  clock: Clock;
  /** Tells that a channel refused the wake for good, so the attempt ended. */
  attemptEnded: (ended: {
    ship: PersonShip;
    channel: WakeChannelName;
    reason: string;
  }) => void;
}): WakePerson {
  /** Channels that refused for good during an attempt still failing, by person ship: a retry of that attempt does not ask them again. */
  const refusedInAttempt = new Map<string, Set<WakeChannelName>>();
  const attemptKey = (ship: PersonShip): string =>
    `${ship.fleetId}/${ship.shipId}`;
  const wakePerson: WakePerson = async (ship, crewToken) => {
    const taken = await deps.door.pushReceive(crewToken, {
      max: RECEIVE_MAX_UPPER_BOUND,
      shouldSkipHanded: true,
    });
    if (!taken.isOk) {
      return taken;
    }
    const everyFresh = taken.value.filter(
      ({ handOverNumber }) => handOverNumber === null,
    );
    // Read anew at every wake, so a change of where a job shows applies at once.
    const [routes, gateway] = await Promise.all([deps.routes.list(ship), deps.connections.binding(ship.fleetId)]);
    // The gateway's own steps never go to Slack: they show in Bridge only (BH8).
    const routing = ownStepsInBridgeOnly(routingOf(routes, deps.defaults), gateway?.shipId);
    // Asked even with nothing fresh: it finishes what an earlier wake left unfinished, as after a restart.
    const shownElsewhere =
      deps.shownElsewhere === undefined
        ? ok({ shown: new Set<DeliveryId>(), isAnyUnfinished: false })
        : await deps.shownElsewhere.show(ship, { crewToken, fresh: everyFresh, routing });
    if (!shownElsewhere.isOk) {
      return shownElsewhere;
    }
    const { shown, isAnyUnfinished } = shownElsewhere.value;
    const woken = await wakeFor(ship, {
      crewToken,
      allFresh: everyFresh.filter(({ deliveryId }) => !shown.has(deliveryId)),
      routing,
    });
    // What it left unfinished is finished at a wake tried again.
    return isAnyUnfinished && woken.isOk && woken.value.kind === "settled"
      ? ok({ kind: "failed" })
      : woken;
  };
  /** Wakes the person for the fresh deliveries nothing beyond the pages showed, each through the channels on for its job. */
  const wakeFor = async (
    ship: PersonShip,
    { crewToken, allFresh, routing }: { crewToken: string; allFresh: readonly PushedPersonDelivery[]; routing: Routing },
  ): Promise<Result<WakeOutcome, FleetRefusal>> => {
    /** Hands each fresh delivery no. 1 through the channel, up to the first refusal: that refusal, or none. */
    const handEach = async (
      fresh: readonly PushedPersonDelivery[],
      channel: HandOverChannel,
    ): Promise<FleetRefusal | undefined> => {
      for (const { deliveryId } of fresh) {
        const handed = await deps.door.handed(crewToken, {
          deliveryId,
          handOverNumber: 1,
          channel,
        });
        if (!handed.isOk) {
          return handed.error;
        }
      }
      return undefined;
    };
    if (allFresh.length === 0) {
      return ok({ kind: "settled" });
    }
    if (
      await deps.focused.isAnyInFocus(
        ship,
        new Date(deps.clock.now().getTime() - deps.focusFreshMs),
      )
    ) {
      const refused = await handEach(allFresh, "page");
      return refused === undefined ? ok({ kind: "settled" }) : err(refused);
    }
    const senderShipIds = [...new Set(allFresh.map(({ senderShipId }) => senderShipId))];
    const [quietShips, quietHours] = await Promise.all([deps.quietShips.among(ship, senderShipIds), deps.quietHours.find(ship)]);
    // A quiet ship wakes nobody: what it sent waits unhanded.
    const wakeRouting = withQuietShips(routing, quietShips);
    const showsOf = (channel: WakeChannel) => (delivery: PushedPersonDelivery): boolean => wakeRouting.isShowing(channel.name, delivery);
    const turnedOn = (
      await Promise.all(
        deps.channels.map(async (channel) =>
          allFresh.some(showsOf(channel)) && (await channel.isOn(ship)) ? [channel] : [],
        ),
      )
    ).flat();
    if (turnedOn.length === 0) {
      return ok({ kind: "settled" });
    }
    const now = deps.clock.now();
    const windows = await Promise.all(
      turnedOn.map(async (channel) => {
        const lastSentAt = await deps.wakesSent.lastSentAt(ship, channel.name);
        return {
          channel,
          lastSentAt,
          endsAt:
            lastSentAt === undefined
              ? now
              : new Date(lastSentAt.getTime() + channel.windowMs),
        };
      }),
    );
    // Only what a channel turned on shows is woken for; the rest waits in Bridge.
    let fresh = allFresh.filter((delivery) => turnedOn.some((channel) => showsOf(channel)(delivery)));
    // What a wake still inside its window covers was left unhanded by a refusal: hand it through that channel.
    for (const { channel, lastSentAt, endsAt } of windows) {
      if (lastSentAt === undefined || endsAt.getTime() <= now.getTime()) {
        continue;
      }
      const covered = fresh.filter(
        (delivery) => showsOf(channel)(delivery) && delivery.sentAt.getTime() <= lastSentAt.getTime(),
      );
      const refused = await handEach(covered, channel.name);
      if (refused !== undefined) {
        return err(refused);
      }
      fresh = fresh.filter((delivery) => !covered.includes(delivery));
    }
    if (fresh.length === 0) {
      return ok({ kind: "settled" });
    }
    const quiet = quietHours === undefined ? undefined : quietSpellAt(quietHours, now);
    if (quiet !== undefined) {
      // Looked at again once a window passes, so quiet hours turned off meanwhile wake by then.
      const nextWindowMs = Math.min(...turnedOn.filter((channel) => fresh.some(showsOf(channel))).map(({ windowMs }) => windowMs));
      return ok({ kind: "inWindow", until: new Date(Math.min(quiet.until.getTime(), now.getTime() + nextWindowMs)) });
    }
    const refusedBefore =
      refusedInAttempt.get(attemptKey(ship)) ?? new Set<WakeChannelName>();
    /** The channels still asked that show any of these deliveries, with their windows. */
    const askedFor = (deliveries: readonly PushedPersonDelivery[]) =>
      windows.filter(
        ({ channel }) => !refusedBefore.has(channel.name) && deliveries.some(showsOf(channel)),
      );
    /** Held back by the earliest window of a channel still asked that shows any of these deliveries, or settled when none is left. */
    const heldBackFor = (deliveries: readonly PushedPersonDelivery[]): WakeOutcome => {
      const waiting = askedFor(deliveries);
      return waiting.length === 0
        ? { kind: "settled" }
        : {
            kind: "inWindow",
            until: new Date(
              Math.min(...waiting.map(({ endsAt }) => endsAt.getTime())),
            ),
          };
    };
    const due = askedFor(fresh)
      .filter(({ endsAt }) => endsAt.getTime() <= now.getTime())
      .map(({ channel }) => channel);
    if (due.length === 0) {
      return ok(heldBackFor(fresh));
    }
    const wentOut: WakeChannel[] = [];
    let isRetryable = false;
    for (const channel of due) {
      // The channel's last recorded wake names the window: every try before the next one is recorded asks with the same key.
      const lastSentAt = windows.find((window) => window.channel === channel)?.lastSentAt;
      const woken = await channel.wake(ship, { key: `${channel.name}:${lastSentAt === undefined ? 'first' : lastSentAt.toISOString()}`, waitsAt: 'personShip', crewToken, deliveries: fresh.filter(showsOf(channel)) });
      if (woken.isOk) {
        wentOut.push(channel);
      } else if (woken.error.kind === "refused") {
        refusedBefore.add(channel.name);
        refusedInAttempt.set(attemptKey(ship), refusedBefore);
        deps.attemptEnded({
          ship,
          channel: channel.name,
          reason: woken.error.reason,
        });
      } else {
        isRetryable = true;
      }
    }
    // Each delivery is handed once, naming the first channel on for its job that went out.
    let refused: FleetRefusal | undefined;
    const left: PushedPersonDelivery[] = [];
    for (const delivery of fresh) {
      const through = wentOut.find((channel) => showsOf(channel)(delivery));
      if (through === undefined) {
        left.push(delivery);
      } else {
        refused ??= await handEach([delivery], through.name);
      }
    }
    // The window is kept only after the hand-overs: a gateway that stopped in between wakes again, as the design says. A refusal keeps it, so no second email follows at once.
    for (const { name } of wentOut) {
      await deps.wakesSent.record({ ship, channel: name, sentAt: now });
    }
    if (refused !== undefined) {
      return err(refused);
    }
    if (left.length === 0) {
      return ok({ kind: "settled" });
    }
    return ok(isRetryable ? { kind: "failed" } : heldBackFor(left.filter((delivery) => !wentOut.some((channel) => showsOf(channel)(delivery)))));
  };
  return async (ship, crewToken) => {
    const woken = await wakePerson(ship, crewToken);
    if (!woken.isOk || woken.value.kind !== "failed") {
      refusedInAttempt.delete(attemptKey(ship));
    }
    return woken;
  };
}
