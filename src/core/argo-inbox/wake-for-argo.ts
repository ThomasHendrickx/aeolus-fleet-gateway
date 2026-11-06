import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { PersonShip, PersonWakes, WakeChannelName, WakeItem } from '../people/person-wakes.js';
import type { Clock } from '../shared/clock.js';
import type { ArgoInbox } from './argo-inbox.js';
import type { ArgoAccounts, ArgoMessage, ArgoWakes } from './ports.js';

/** Wakes every person allowed as argo, in every fleet the gateway is connected to, for what waits at argo now. */
export type WakeForArgo = () => Promise<void>;

/** What waits at argo for one person, not covered yet, and when to try a wake for it next: none until something changes. */
interface Waiting {
  readonly ship: PersonShip;
  readonly pending: ReadonlyMap<MessageId, ArgoMessage>;
  readonly dueAt: Date | null;
}

/** What a fleet's round saw open at argo, and each person allowed as argo there. */
interface Seen {
  readonly open: ReadonlyMap<MessageId, ArgoMessage>;
  readonly persons: ReadonlyMap<ShipId, Waiting>;
}

function itemOf({ messageId, contentType, sentAt, sender }: ArgoMessage): WakeItem {
  return { key: messageId, contentType, sentAt, senderShipId: sender.shipId };
}

function withoutKeys<K, V>(map: ReadonlyMap<K, V>, keys: Iterable<K>): Map<K, V> {
  const left = new Map(map);
  for (const key of keys) {
    left.delete(key);
  }
  return left;
}

/**
 * Use case: a wake of its own for what waits at argo (argo's inbox, AI4, AI5,
 * AI9). For each message open at argo, as the gateway's ship last read argo's
 * inbox, the person ship of every account allowed as argo is woken once,
 * following the person's own rules through People's published port (wake a
 * person, W1 to W10): through the channels on for the message's job (W8),
 * each at most once per its window, gathering what arrives inside it (W3),
 * and not while a page of the person is in focus, which shows it instead
 * (W6). A quiet ship's message wakes nobody, and during the person's quiet
 * hours no wake goes out: it is tried again once they end or a window
 * passes, whichever comes first (preferences design). It is kept apart from the person's own wake: its own windows, its own
 * keys, and it says it waits at argo. A message done at argo is no longer
 * open, so done inside a window it wakes nobody.
 *
 * A round reads only what changed at argo since the last one: the messages
 * that arrived are looked up for each person, the ones done are forgotten,
 * and a person is tried again only when something arrived or a window it
 * waits on passed. A person first seen, as after a restart, is read for what
 * is open now. A message is covered only after its wake went out and before
 * the window is kept, so a gateway that stopped in between wakes once more,
 * never not at all.
 */
export function createWakeForArgo(deps: {
  connections: Pick<ConnectionStore, 'connected'>;
  accounts: ArgoAccounts;
  /** argo's inbox in a fleet as the gateway's ship last read it. */
  inboxOf: (fleetId: FleetId) => ArgoInbox | undefined;
  people: PersonWakes;
  argoWakes: ArgoWakes;
  clock: Clock;
}): WakeForArgo {
  const seen = new Map<FleetId, Seen>();

  const pendingOf = async (ship: PersonShip, messages: readonly ArgoMessage[]): Promise<ArgoMessage[]> => {
    const covered = await deps.argoWakes.coveredAmong(
      ship,
      messages.map(({ messageId }) => messageId),
    );
    return messages.filter(({ messageId }) => !covered.has(messageId));
  };

  const firstSight = async (ship: PersonShip, open: readonly ArgoMessage[]): Promise<Waiting> => {
    const openIds = open.map(({ messageId }) => messageId);
    await deps.argoWakes.forgetAllBut(ship, openIds);
    const pending = open.length === 0 ? [] : await pendingOf(ship, open);
    return { ship, pending: new Map(pending.map((message) => [message.messageId, message])), dueAt: pending.length === 0 ? null : deps.clock.now() };
  };

  const changed = async ({ held, arrived, done }: { held: Waiting; arrived: readonly ArgoMessage[]; done: readonly MessageId[] }): Promise<Waiting> => {
    if (done.length > 0) {
      await deps.argoWakes.forget(held.ship, done);
    }
    const fresh = arrived.length === 0 ? [] : await pendingOf(held.ship, arrived);
    const pending = withoutKeys(held.pending, done);
    for (const message of fresh) {
      pending.set(message.messageId, message);
    }
    return { ship: held.ship, pending, dueAt: fresh.length > 0 ? deps.clock.now() : held.dueAt };
  };

  /** Wakes the person for what waits for them, as far as the windows let: what is left, and when to try again. */
  const attempt = async ({ ship, pending }: Waiting): Promise<Waiting> => {
    if (pending.size === 0) {
      return { ship, pending, dueAt: null };
    }
    if (await deps.people.isInFocus(ship)) {
      await deps.argoWakes.cover(ship, [...pending.keys()]);
      return { ship, pending: new Map(), dueAt: null };
    }
    const now = deps.clock.now();
    const [showing, quietUntil] = await Promise.all([deps.people.showing(ship, [...pending.values()].map(itemOf)), deps.people.quietUntil(ship)]);
    if (quietUntil !== undefined) {
      // Looked at again once a window passes, so quiet hours turned off meanwhile wake by then.
      const nextWindowMs = Math.min(...showing.map(({ windowMs }) => windowMs));
      return { ship, pending, dueAt: showing.length === 0 ? null : new Date(Math.min(quietUntil.getTime(), now.getTime() + nextWindowMs)) };
    }
    const shown = new Set<string>();
    const kept: WakeChannelName[] = [];
    const heldUntil: number[] = [];
    let isRetried = false;
    for (const channel of showing) {
      const lastSentAt = await deps.argoWakes.lastSentAt(ship, channel.name);
      if (lastSentAt !== undefined && lastSentAt.getTime() + channel.windowMs > now.getTime()) {
        heldUntil.push(lastSentAt.getTime() + channel.windowMs);
        continue;
      }
      // The channel's last argo wake names the window, apart from the person's own: every try of one window asks with the same key.
      const woken = await deps.people.wake(ship, { channel: channel.name, window: { key: `argo:${channel.name}:${lastSentAt === undefined ? 'first' : lastSentAt.toISOString()}`, waitsAt: 'argo' } });
      if (woken.isOk) {
        kept.push(channel.name);
        channel.keys.forEach((key) => shown.add(key));
      } else if (woken.error.kind === 'refused') {
        // A refusal for good keeps the window too, so the channel is not asked again before it passed; it covers nothing.
        kept.push(channel.name);
        heldUntil.push(now.getTime() + channel.windowMs);
      } else {
        isRetried = true;
      }
    }
    const covered = [...pending.keys()].filter((messageId) => shown.has(messageId));
    if (covered.length > 0) {
      await deps.argoWakes.cover(ship, covered);
    }
    for (const channel of kept) {
      await deps.argoWakes.record({ ship, channel, sentAt: now });
    }
    const left = withoutKeys(pending, covered);
    if (left.size === 0) {
      return { ship, pending: left, dueAt: null };
    }
    // A wake that did not go out is tried at the next round; one held back, once its window passed.
    const dueAt = isRetried ? now : heldUntil.length === 0 ? null : new Date(Math.min(...heldUntil));
    return { ship, pending: left, dueAt };
  };

  const roundOf = async (fleetId: FleetId, messages: readonly ArgoMessage[]): Promise<Seen> => {
    const before = seen.get(fleetId);
    const open = new Map(messages.map((message) => [message.messageId, message]));
    const arrived = messages.filter(({ messageId }) => before?.open.has(messageId) !== true);
    const done = before === undefined ? [] : [...before.open.keys()].filter((messageId) => !open.has(messageId));
    const persons = new Map<ShipId, Waiting>();
    for (const { personShipId } of await deps.accounts.list(fleetId)) {
      const ship = { fleetId, shipId: personShipId };
      const held = before?.persons.get(personShipId);
      const waiting = held === undefined ? await firstSight(ship, messages) : await changed({ held, arrived, done });
      const isDue = waiting.dueAt !== null && waiting.dueAt.getTime() <= deps.clock.now().getTime();
      persons.set(personShipId, isDue ? await attempt(waiting) : waiting);
    }
    return { open, persons };
  };

  return async () => {
    const connected = await deps.connections.connected();
    const fleetIds = new Set(connected.map(({ fleetId }) => fleetId));
    for (const fleetId of seen.keys()) {
      if (!fleetIds.has(fleetId)) {
        seen.delete(fleetId);
      }
    }
    for (const fleetId of fleetIds) {
      const inbox = deps.inboxOf(fleetId);
      if (inbox?.kind === 'read') {
        seen.set(fleetId, await roundOf(fleetId, inbox.messages));
      } else {
        // Read again from what is open once argo lets the ship read its inbox again.
        seen.delete(fleetId);
      }
    }
  };
}
