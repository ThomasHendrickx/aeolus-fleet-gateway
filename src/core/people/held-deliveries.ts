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
 * time), on every instance, so one arriving as another instance acknowledges
 * one is still received. An instance that may have missed a let-go forgets
 * all it holds. Held in memory only: a restart receives once again.
 *
 * A plain message whose sender is not retired is held for a minute only: the
 * sender may retire, which no count of what waits shows, and the person's
 * count leaves a retired sender's plain messages out (#322).
 */
import type { DeliveryId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { isPlainMessage } from './plain-message.js';
import type { LetGoDeliveries, PersonDelivery, PersonShipDoor } from './ports.js';

/** How long the gateway trusts the sender status of a plain message it holds: a retire changes no count of what waits, so it receives the message again after this. */
export const HELD_SENDER_STATUS_MAX_AGE_MS = 60_000;

export interface HeldDeliveries {
  /** What the crew received and holds, oldest first; none before its first look. */
  of(crewToken: string): readonly PersonDelivery[] | undefined;
  hold(crewToken: string, deliveries: readonly PersonDelivery[]): void;
  /** Lets go of the delivery whatever crew holds it: a delivery id is the fleet's own, and one crew at most holds it. */
  letGo(deliveryId: DeliveryId): void;
  forgetAll(): void;
}

export function createHeldDeliveries(clock: Clock): HeldDeliveries {
  const byCrew = new Map<string, readonly PersonDelivery[]>();
  /** When each delivery was received, by the delivery itself, so one received anew starts its minute again. */
  const heldAt = new WeakMap<PersonDelivery, number>();
  const isStale = (delivery: PersonDelivery): boolean =>
    isPlainMessage(delivery.contentType) && delivery.senderStatus !== 'retired' && clock.now().getTime() - (heldAt.get(delivery) ?? 0) >= HELD_SENDER_STATUS_MAX_AGE_MS;
  return {
    of: (crewToken) => byCrew.get(crewToken)?.filter((delivery) => !isStale(delivery)),
    hold: (crewToken, deliveries) => {
      for (const delivery of deliveries) {
        if (!heldAt.has(delivery)) {
          heldAt.set(delivery, clock.now().getTime());
        }
      }
      byCrew.set(crewToken, deliveries);
    },
    letGo: (deliveryId) => {
      for (const [crewToken, held] of byCrew) {
        byCrew.set(
          crewToken,
          held.filter((delivery) => delivery.deliveryId !== deliveryId),
        );
      }
    },
    forgetAll: () => {
      byCrew.clear();
    },
  };
}

/** The person ship's door, letting go of each delivery its acknowledgement or last hand-over ends the wait of, and telling every instance. */
export function holdingDoor(door: PersonShipDoor, holding: { held: HeldDeliveries; letGo: LetGoDeliveries }): PersonShipDoor {
  const letGo = async (deliveryId: DeliveryId): Promise<void> => {
    holding.held.letGo(deliveryId);
    await holding.letGo.tell(deliveryId);
  };
  return {
    ...door,
    ack: async (crewToken, deliveryId) => {
      const acknowledged = await door.ack(crewToken, deliveryId);
      if (acknowledged.isOk) {
        await letGo(deliveryId);
      }
      return acknowledged;
    },
    handed: async (crewToken, handOver) => {
      const handed = await door.handed(crewToken, handOver);
      if (handed.isOk && handed.value !== 'handed') {
        await letGo(handOver.deliveryId);
      }
      return handed;
    },
  };
}
