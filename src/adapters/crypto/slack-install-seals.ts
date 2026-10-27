import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { InstallStates } from '../../core/slack/ports.js';
import { createSealer } from './sealer.js';

/** Its own label, so no other sealed text opens as an install's state. */
const SEAL_LABEL = 'slack-install-seal';

const sealedSchema = z.object({ fleetId: idSchema('fleet'), appId: z.string(), expiresAt: z.coerce.date() });

/** Seals a Slack install's state into Slack's install address, under a key derived from the gateway's secret. */
export function createSlackInstallSeals(secret: string): InstallStates {
  const sealer = createSealer(secret, SEAL_LABEL);
  return {
    seal: (state) => sealer.seal({ ...state, expiresAt: state.expiresAt.toISOString() }),
    open: (sealed) => sealedSchema.safeParse(sealer.open(sealed)).data,
  };
}
