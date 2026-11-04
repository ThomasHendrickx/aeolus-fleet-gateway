/**
 * What the gateway holds of each person ship's waiting deliveries, by the
 * crew token that received them (aeolus-fleet #1647). Every receive hands the
 * crew's held deliveries again and the fleet writes each again, so a look at
 * what waits takes only how many wait while the gateway holds as many: a look
 * is a read.
 *
 * Staleness rule: what is held stands while the fleet counts as many waiting
 * as are held, under the same crew token. The gateway lets go of a delivery
 * once its own call ends its wait (acknowledged, or handed for the last
 * time), so one arriving as it acknowledges another is still received. Held
 * in memory only: a restart receives once again.
 */
import type { DeliveryId } from '@aeolus-fleet/common';

import type { PersonDelivery, PersonShipDoor } from './ports.js';

export interface HeldDeliveries {
  /** What the crew received and holds, oldest first; none before its first look. */
  of(crewToken: string): readonly PersonDelivery[] | undefined;
  hold(crewToken: string, deliveries: readonly PersonDelivery[]): void;
  letGo(crewToken: string, deliveryId: DeliveryId): void;
}

export function createHeldDeliveries(): HeldDeliveries {
  const byCrew = new Map<string, readonly PersonDelivery[]>();
  return {
    of: (crewToken) => byCrew.get(crewToken),
    hold: (crewToken, deliveries) => {
      byCrew.set(crewToken, deliveries);
    },
    letGo: (crewToken, deliveryId) => {
      const held = byCrew.get(crewToken);
      if (held !== undefined) {
        byCrew.set(
          crewToken,
          held.filter((delivery) => delivery.deliveryId !== deliveryId),
        );
      }
    },
  };
}

/** The person ship's door, letting go of each delivery its acknowledgement or last hand-over ends the wait of. */
export function holdingDoor(door: PersonShipDoor, held: HeldDeliveries): PersonShipDoor {
  return {
    ...door,
    ack: async (crewToken, deliveryId) => {
      const acknowledged = await door.ack(crewToken, deliveryId);
      if (acknowledged.isOk) {
        held.letGo(crewToken, deliveryId);
      }
      return acknowledged;
    },
    handed: async (crewToken, handOver) => {
      const handed = await door.handed(crewToken, handOver);
      if (handed.isOk && handed.value !== 'handed') {
        held.letGo(crewToken, handOver.deliveryId);
      }
      return handed;
    },
  };
}
