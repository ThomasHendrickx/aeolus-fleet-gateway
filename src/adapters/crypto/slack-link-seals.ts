import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { LinkStates } from '../../core/slack/ports.js';
import { createSealer } from './sealer.js';

/** Its own label, so no other sealed text opens as a link's state. */
const SEAL_LABEL = 'slack-link-seal';

const sealedSchema = z.object({ fleetId: idSchema('fleet'), accountId: z.string(), personShipId: idSchema('ship'), expiresAt: z.coerce.date() });

/** Seals a Slack link's state into Sign in with Slack's address, under a key derived from the gateway's secret. */
export function createSlackLinkSeals(secret: string): LinkStates {
  const sealer = createSealer(secret, SEAL_LABEL);
  return {
    seal: (state) => sealer.seal({ ...state, expiresAt: state.expiresAt.toISOString() }),
    open: (sealed) => sealedSchema.safeParse(sealer.open(sealed)).data,
  };
}
