/** Invalid cached deliveries must be received again, and invalid opened items never wait on the person. */
import type { HeldDeliveries } from './held-deliveries.js';
import type { OpenedDeliveries } from './ports.js';
import { unreadableItem } from './unreadable-item.js';
import { isUnreadableOpenedItem } from './unreadable-opened-item.js';

export function createReadablePersonState(state: { held: HeldDeliveries; opened: OpenedDeliveries }): { held: HeldDeliveries; opened: OpenedDeliveries } {
  return {
    held: {
      ...state.held,
      of: (crewToken) => state.held.of(crewToken)?.filter((delivery) => unreadableItem(delivery) === null),
    },
    opened: {
      ...state.opened,
      list: async (fleetId, shipId) => (await state.opened.list(fleetId, shipId)).filter((delivery) => !isUnreadableOpenedItem(delivery)),
      find: async (fleetId, asked) => {
        const delivery = await state.opened.find(fleetId, asked);
        return delivery === undefined || isUnreadableOpenedItem(delivery) ? undefined : delivery;
      },
    },
  };
}
