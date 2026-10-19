/**
 * A person's own ship, which the gateway crews for them (interop 3.3 point
 * 5): the calls it makes as the ship's crew, so the person's chat holds no
 * crew token.
 */
import type { DeliveryId, MessageId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/** A delivery to the person's ship, as the fleet's push receive hands it. */
export interface PersonDelivery {
  readonly deliveryId: DeliveryId;
  readonly messageId: MessageId;
  readonly senderName: string;
  readonly contentType: string;
  readonly payload: string;
  /** The title of a question (the question content type), read at the edge; none for any other message. */
  readonly questionTitle: string | null;
  readonly sentAt: Date;
  readonly inReplyTo: MessageId | null;
}

/** Outbound port: the fleet's calls the gateway makes as the crew of a person's ship. */
export interface PersonShipDoor {
  /** How many deliveries wait for the ship, without waiting. */
  inbox(crewToken: string): Promise<Result<{ waiting: number }, FleetRefusal>>;
  /** The ship's deliveries, up to max, its own held ones again first; it waits a while when none waits. */
  pushReceive(crewToken: string, take: { max: number }): Promise<Result<PersonDelivery[], FleetRefusal>>;
}
