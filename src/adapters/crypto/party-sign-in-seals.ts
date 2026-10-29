import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { PartySignInSeals } from '../../core/party-grants/ports.js';
import { createSealer } from './sealer.js';

/** Its own label, so no other sealed text opens as a party sign-in's state. */
const SEAL_LABEL = 'party-sign-in-seal';

const sealedSchema = z.object({ fleetId: idSchema('fleet'), party: z.string(), accountId: z.string(), personShipId: idSchema('ship'), verifier: z.string(), expiresAt: z.coerce.date() });

/** Seals a person's sign-in to a party into the state its authorization server carries back, under a key derived from the gateway's secret: the PKCE verifier travels encrypted. */
export function createPartySignInSeals(secret: string): PartySignInSeals {
  const sealer = createSealer(secret, SEAL_LABEL);
  return {
    seal: (signIn) => sealer.seal({ ...signIn, expiresAt: signIn.expiresAt.toISOString() }),
    open: (sealed) => sealedSchema.safeParse(sealer.open(sealed)).data,
  };
}
