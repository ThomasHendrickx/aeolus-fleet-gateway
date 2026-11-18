/** Fleet events use the connected gateway ship's fleet:read authority. */
import { fleetStreamItemSchema } from '@aeolus-fleet/common';

import { createEventStream, type EventStreamOptions } from './event-stream.js';

export function createFleetEvents(options: EventStreamOptions) {
  return createEventStream(options, {
    path: 'fleet/events',
    // A caught-up stream can stay silent, so refresh after every opening.
    shouldLookOnOpen: true,
    accepts: ({ event, data }) => {
      if (event !== '' || data === '') { return false; }
      try {
        return fleetStreamItemSchema.safeParse(JSON.parse(data)).success;
      } catch {
        // Invalid events cannot move the replay position.
        return false;
      }
    },
  });
}
