import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { WaitingSeals } from '../../core/requests/ports.js';
import { createSealer, setParameters } from './sealer.js';

/** Its own label, so a sign-in's state never opens as a waiting, nor a waiting as a sign-in. */
const SEAL_LABEL = 'waiting-seal';

const sealedSchema = z.object({
  fleetId: idSchema('fleet'),
  requestId: z.string(),
  accountId: z.string(),
  browserSecret: z.string(),
  request: z.record(z.string(), z.string()),
});

/** Seals a browser's waiting into the waiting page's address, under a key derived from the gateway's secret. */
export function createWaitingSeals(secret: string): WaitingSeals {
  const sealer = createSealer(secret, SEAL_LABEL);
  return {
    seal: (waiting) => sealer.seal({ ...waiting, request: setParameters(waiting.request) }),
    open: (sealed) => {
      const waiting = sealedSchema.safeParse(sealer.open(sealed));
      return waiting.success ? waiting.data : undefined;
    },
  };
}
