import type { MessageId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { PersonShip, PersonWakes, WakeChannelName, WakeItem } from '../people/person-wakes.js';
import type { Clock } from '../shared/clock.js';
import type { ArgoInbox } from './argo-inbox.js';
import type { ArgoAccounts, ArgoMessage, ArgoWakes } from './ports.js';

/** Wakes every person allowed as argo, in every fleet the gateway is connected to, for what waits at argo now. */
export type WakeForArgo = () => Promise<void>;

function itemOf({ messageId, contentType, sentAt, sender }: ArgoMessage): WakeItem {
  return { key: messageId, contentType, sentAt, senderShipId: sender.shipId };
}

/**
 * Use case: a wake of its own for what waits at argo (argo's inbox, AI4, AI5,
 * AI9). For each message open at argo, as the gateway's ship last read argo's
 * inbox, the person ship of every account allowed as argo is woken once,
 * following the person's own rules through People's published port (wake a
 * person, W1 to W10): through the channels on for the message's job (W8),
 * each at most once per its window, gathering what arrives inside it (W3),
 * and not while a page of the person is in focus, which shows it instead
 * (W6). It is kept apart from the person's own wake: its own windows, its own
 * keys, and it says it waits at argo. A message done at argo is no longer
 * open, so done inside a window it wakes nobody. A message is covered only
 * after its wake went out and before the window is kept, so a gateway that
 * stopped in between wakes once more, never not at all.
 */
export function createWakeForArgo(deps: {
  connections: Pick<ConnectionStore, 'connected'>;
  accounts: ArgoAccounts;
  /** argo's inbox in a fleet as the gateway's ship last read it. */
  inboxOf: (fleetId: PersonShip['fleetId']) => ArgoInbox | undefined;
  people: PersonWakes;
  argoWakes: ArgoWakes;
  clock: Clock;
}): WakeForArgo {
  const wakeFor = async (ship: PersonShip, open: readonly ArgoMessage[]): Promise<void> => {
    await deps.argoWakes.forgetAllBut(
      ship,
      open.map(({ messageId }) => messageId),
    );
    const covered = await deps.argoWakes.coveredOf(ship);
    const fresh = open.filter(({ messageId }) => !covered.has(messageId));
    if (fresh.length === 0) {
      return;
    }
    if (await deps.people.isInFocus(ship)) {
      await deps.argoWakes.cover(
        ship,
        fresh.map(({ messageId }) => messageId),
      );
      return;
    }
    const now = deps.clock.now();
    const shownBy = new Set<string>();
    const kept: WakeChannelName[] = [];
    for (const channel of await deps.people.showing(ship, fresh.map(itemOf))) {
      const lastSentAt = await deps.argoWakes.lastSentAt(ship, channel.name);
      if (lastSentAt !== undefined && lastSentAt.getTime() + channel.windowMs > now.getTime()) {
        continue;
      }
      // The channel's last argo wake names the window, apart from the person's own: every try of one window asks with the same key.
      const woken = await deps.people.wake(ship, { channel: channel.name, window: { key: `argo:${channel.name}:${lastSentAt === undefined ? 'first' : lastSentAt.toISOString()}`, waitsAt: 'argo' } });
      if (woken.isOk) {
        kept.push(channel.name);
        channel.keys.forEach((key) => shownBy.add(key));
      } else if (woken.error.kind === 'refused') {
        // A refusal for good keeps the window too, so the channel is not asked again before it passed; it covers nothing.
        kept.push(channel.name);
      }
    }
    const wokenFor: MessageId[] = fresh.map(({ messageId }) => messageId).filter((messageId) => shownBy.has(messageId));
    await deps.argoWakes.cover(ship, wokenFor);
    for (const channel of kept) {
      await deps.argoWakes.record({ ship, channel, sentAt: now });
    }
  };

  return async () => {
    for (const { fleetId } of await deps.connections.connected()) {
      const inbox = deps.inboxOf(fleetId);
      if (inbox?.kind !== 'read') {
        continue;
      }
      for (const { personShipId } of await deps.accounts.list(fleetId)) {
        await wakeFor({ fleetId, shipId: personShipId }, inbox.messages);
      }
    }
  };
}
