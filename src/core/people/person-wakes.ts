/**
 * People's published port for waking a person for what waits outside their
 * own person ship, as argo's inbox does for the people allowed as argo: the
 * person's own rules (wake a person, W1 to W10) without their model or
 * stores. A page in focus (W6), the channels on for each item's job (W8,
 * Bridge section 8) without the person's quiet ships, the quiet hours in
 * effect (preferences design), and the wake itself.
 */
import type { ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { err, type Result } from '../shared/result.js';
import type { FocusedPages, PersonShip, WakeChannel, WakeChannelName, WakeWindow } from './ports.js';
import { quietSpellAt, type QuietHoursStore } from './quiet-hours.js';
import { withQuietShips, type QuietShips } from './quiet-ships.js';
import { routingOf, type RoutingDefaults, type Routes } from './routing.js';

export type { PersonShip, WakeChannelName, WakeWindow } from './ports.js';

/** An item a wake would be for, by a key of the caller's: its content type names its job. */
export interface WakeItem {
  readonly key: string;
  readonly contentType: string;
  readonly sentAt: Date;
  readonly senderShipId: ShipId;
}

/** A channel on now for the person, its window, and the keys of the items it shows. */
export interface ChannelShowing {
  readonly name: WakeChannelName;
  readonly windowMs: number;
  readonly keys: readonly string[];
}

export interface PersonWakes {
  /** Whether a page of the person is in focus now, which shows what arrives instead of a wake (W6). */
  isInFocus(ship: PersonShip): Promise<boolean>;
  /** When the person's quiet hours in effect now end; none outside them. */
  quietUntil(ship: PersonShip): Promise<Date | undefined>;
  /** The channels on now for the person that show any of the items, as they routed each job (W8), none for a quiet ship's. */
  showing(ship: PersonShip, items: readonly WakeItem[]): Promise<readonly ChannelShowing[]>;
  /** Wakes the person through the channel: whether it went out, refused for good or unavailable for now. */
  wake(ship: PersonShip, wake: { channel: WakeChannelName; window: WakeWindow }): Promise<Result<undefined, { kind: 'refused' | 'unavailable'; reason: string }>>;
}

export function createPersonWakes(deps: {
  channels: readonly WakeChannel[];
  routes: Routes;
  defaults: RoutingDefaults;
  quietHours: Pick<QuietHoursStore, 'find'>;
  quietShips: Pick<QuietShips, 'among'>;
  focused: FocusedPages;
  /** How long a page counts in focus since it was last seen so. */
  focusFreshMs: number;
  clock: Clock;
}): PersonWakes {
  return {
    isInFocus: (ship) => deps.focused.isAnyInFocus(ship, new Date(deps.clock.now().getTime() - deps.focusFreshMs)),
    quietUntil: async (ship) => {
      const hours = await deps.quietHours.find(ship);
      return hours === undefined ? undefined : quietSpellAt(hours, deps.clock.now())?.until;
    },
    showing: async (ship, items) => {
      // Read anew each time, so a change of where a job shows, or of a quiet ship, applies at once.
      const senderShipIds = [...new Set(items.map(({ senderShipId }) => senderShipId))];
      const [routes, quietShips] = await Promise.all([deps.routes.list(ship), deps.quietShips.among(ship, senderShipIds)]);
      const routing = withQuietShips(routingOf(routes, deps.defaults), quietShips);
      const showing: ChannelShowing[] = [];
      for (const channel of deps.channels) {
        const keys = items.filter((item) => routing.isShowing(channel.name, item)).map(({ key }) => key);
        if (keys.length > 0 && (await channel.isOn(ship))) {
          showing.push({ name: channel.name, windowMs: channel.windowMs, keys });
        }
      }
      return showing;
    },
    wake: async (ship, { channel, window }) => {
      const found = deps.channels.find(({ name }) => name === channel);
      if (found === undefined) {
        return err({ kind: 'refused', reason: `no ${channel} channel` });
      }
      return found.wake(ship, window);
    },
  };
}
