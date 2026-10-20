import { z } from 'zod';

import type { SignInSeals } from '../../core/sign-in/ports.js';
import { createSealer, setParameters } from './sealer.js';

/** Its own label, so the sealing key is never also a key the gateway derives elsewhere. */
const SEAL_LABEL = 'sign-in-seal';

const sealedSchema = z.object({
  verifier: z.string(),
  browserSecret: z.string(),
  request: z.record(z.string(), z.string()),
  holder: z.enum(['account', 'party']),
  expiresAt: z.iso.datetime(),
});

/**
 * Seals a sign-in under way into the state pagasae carries back, under a key
 * derived from the gateway's secret. A state changed on the way, or sealed
 * under another secret, opens to nothing.
 */
export function createSignInSeals(secret: string): SignInSeals {
  const sealer = createSealer(secret, SEAL_LABEL);
  return {
    seal: ({ verifier, browserSecret, request, holder, expiresAt }) => sealer.seal({ verifier, browserSecret, request: setParameters(request), holder, expiresAt: expiresAt.toISOString() }),
    open: (state) => {
      const signIn = sealedSchema.safeParse(sealer.open(state));
      return signIn.success ? { ...signIn.data, expiresAt: new Date(signIn.data.expiresAt) } : undefined;
    },
  };
}
