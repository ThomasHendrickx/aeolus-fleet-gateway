import type { ConnectionStore } from '../connection/ports.js';
import type { FocusedPages, PersonShip, WakeChannel } from '../people/ports.js';
import { routingOf, type Routing, type RoutingDefaults, type Routes } from '../people/routing.js';
import type { Clock } from '../shared/clock.js';
import type { ArgoInbox } from './argo-inbox.js';
import type { ArgoAccounts, ArgoMessage, ArgoWakes } from './ports.js';

/** Wakes every person allowed as argo, in every fleet the gateway is connected to, for what waits at argo now. */
export type WakeForArgo = () => Promise<void>;

/**
 * Use case: a wake of its own for what waits at argo (argo's inbox, AI4, AI5,
 * AI9). For each message open at argo, as the gateway's ship last read argo's
 * inbox, the person ship of every account allowed as argo is woken once,
 * following the person's own rules (wake a person, W1 to W10): through the
 * channels turned on for the message's job (W8, Bridge section 8), each at
 * most once per its window, gathering what arrives inside it (W3), and not
 * while a page of the person is in focus, which shows it instead (W6). It is
 * kept apart from the person's own wake: its own windows, its own keys, and
 * it says it waits at argo. A message done at argo is no longer open, so
 * done inside a window it wakes nobody. A message is covered only after its
 * wake went out and before the window is kept, so a gateway that stopped in
 * between wakes once more, never not at all.
 */
export function createWakeForArgo(deps: {
  connections: Pick<ConnectionStore, 'connected'>;
  accounts: ArgoAccounts;
  /** argo's inbox in a fleet as the gateway's ship last read it. */
  inboxOf: (fleetId: PersonShip['fleetId']) => ArgoInbox | undefined;
  channels: readonly WakeChannel[];
  routes: Routes;
  defaults: RoutingDefaults;
  argoWakes: ArgoWakes;
  focused: FocusedPages;
  /** How long a page counts in focus since it was last seen so. */
  focusFreshMs: number;
  clock: Clock;
}): WakeForArgo {
  const isShowing = (routing: Routing, channel: WakeChannel) => (message: ArgoMessage): boolean =>
    routing.isShowing(channel.name, { contentType: message.contentType, sentAt: message.sentAt, senderShipId: message.sender.shipId });

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
    const now = deps.clock.now();
    if (await deps.focused.isAnyInFocus(ship, new Date(now.getTime() - deps.focusFreshMs))) {
      await deps.argoWakes.cover(
        ship,
        fresh.map(({ messageId }) => messageId),
      );
      return;
    }
    const routing = routingOf(await deps.routes.list(ship), deps.defaults);
    const wentOut: WakeChannel[] = [];
    const refused: WakeChannel[] = [];
    for (const channel of deps.channels) {
      if (!fresh.some(isShowing(routing, channel)) || !(await channel.isOn(ship))) {
        continue;
      }
      const lastSentAt = await deps.argoWakes.lastSentAt(ship, channel.name);
      if (lastSentAt !== undefined && lastSentAt.getTime() + channel.windowMs > now.getTime()) {
        continue;
      }
      // The channel's last argo wake names the window, apart from the person's own: every try of one window asks with the same key.
      const woken = await channel.wake(ship, { key: `argo:${channel.name}:${lastSentAt === undefined ? 'first' : lastSentAt.toISOString()}`, waitsAt: 'argo' });
      if (woken.isOk) {
        wentOut.push(channel);
      } else if (woken.error.kind === 'refused') {
        refused.push(channel);
      }
    }
    await deps.argoWakes.cover(
      ship,
      fresh.filter((message) => wentOut.some((channel) => isShowing(routing, channel)(message))).map(({ messageId }) => messageId),
    );
    // A refusal for good keeps the window too, so the channel is not asked again before it passed; it covers nothing.
    for (const { name } of [...wentOut, ...refused]) {
      await deps.argoWakes.record({ ship, channel: name, sentAt: now });
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
