import { createIdGenerator } from '@aeolus-fleet/common';

import type { RequestIds } from '../../core/requests/ports.js';

/** New request ids: common's time-ordered ids of kind request (`req_`). */
export function createRequestIds(options: Parameters<typeof createIdGenerator>[0] = {}): RequestIds {
  const generate = createIdGenerator(options);
  return { newRequestId: () => generate('request') };
}
