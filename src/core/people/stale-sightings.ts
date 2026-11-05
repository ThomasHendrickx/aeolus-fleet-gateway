/**
 * When the gateway first saw each question or step stale, withdrawn or
 * replaced by its asker (Bridge #240): it stays in Bridge's lists 5 s from
 * then, counted from when the withdrawal reached Bridge, not from when it was
 * sent, so a late one still shows. Held in memory only: a restart sees each
 * stale item anew, which keeps it at most 5 s longer.
 */
import type { DeliveryId } from '@aeolus-fleet/common';

/** How long a stale question or step stays in Bridge's lists after the gateway first saw it stale; then the gateway ends it. */
export const STALE_SHOWN_FOR_MS = 5000;

export interface StaleSightings {
  /** When the gateway first saw the item stale: now, at its first sight. */
  firstSeen(deliveryId: DeliveryId, now: Date): Date;
  /** Forgets the item once ended. */
  forget(deliveryId: DeliveryId): void;
}

export function createStaleSightings(): StaleSightings {
  const seenAt = new Map<DeliveryId, Date>();
  return {
    firstSeen: (deliveryId, now) => {
      const at = seenAt.get(deliveryId) ?? now;
      seenAt.set(deliveryId, at);
      return at;
    },
    forget: (deliveryId) => {
      seenAt.delete(deliveryId);
    },
  };
}
