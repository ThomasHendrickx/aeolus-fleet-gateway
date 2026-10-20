import { createIdGenerator } from '@aeolus-fleet/common';

import type { RequestIds } from '../../core/requests/ports.js';

/** The prefix common gives a pending request from 0.28.0 (`ID_PREFIXES.request`); until then its time-ordered body is drawn here (aeolus-fleet#991). */
const REQUEST_PREFIX = 'req_';

/** New request ids: a common id's time-ordered body under the request prefix. */
export function createRequestIds(options: Parameters<typeof createIdGenerator>[0] = {}): RequestIds {
  const generate = createIdGenerator(options);
  return {
    newRequestId: () => {
      const id = generate('event');
      return `${REQUEST_PREFIX}${id.slice(id.indexOf('_') + 1)}`;
    },
  };
}
