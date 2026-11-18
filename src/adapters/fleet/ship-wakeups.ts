/** Ship wake hints request a look without carrying a delivery. */
import { createEventStream, type EventStreamOptions } from './event-stream.js';

export function createShipWakeups(options: EventStreamOptions) {
  return createEventStream(options, {
    path: 'ship/wakeups',
    shouldLookOnOpen: false,
    accepts: ({ event }) => event === 'wake',
  });
}
