import { z } from 'zod';

import type { AccountSignInSeals } from '../../core/account-sign-in/ports.js';
import { createSealer } from './sealer.js';

/** Its own label, so a state sealed for an MCP client's sign-in never opens here, nor the other way round. */
const SEAL_LABEL = 'account-sign-in-seal';

const sealedSchema = z.object({ verifier: z.string(), browserSecret: z.string(), returnTo: z.string(), expiresAt: z.iso.datetime() });

/**
 * Seals a sign-in to the gateway's pages into the state pagasae carries
 * back, under a key derived from the gateway's secret. A state changed on
 * the way, or sealed under another secret or label, opens to nothing.
 */
export function createAccountSignInSeals(secret: string): AccountSignInSeals {
  const sealer = createSealer(secret, SEAL_LABEL);
  return {
    seal: (signIn) => sealer.seal({ ...signIn, expiresAt: signIn.expiresAt.toISOString() }),
    open: (state) => {
      const signIn = sealedSchema.safeParse(sealer.open(state));
      return signIn.success ? { ...signIn.data, expiresAt: new Date(signIn.data.expiresAt) } : undefined;
    },
  };
}
