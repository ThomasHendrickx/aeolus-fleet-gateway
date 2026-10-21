import { z } from 'zod';

import type { SignInSeals } from '../../core/sign-in/ports.js';
import { createSealer, setParameters } from './sealer.js';

/** Its own label, so the sealing key is never also a key the gateway derives elsewhere. */
const SEAL_LABEL = 'sign-in-seal';

const underWay = { verifier: z.string(), browserSecret: z.string(), expiresAt: z.iso.datetime() };
const sealedSchema = z.object({ ...underWay, holder: z.enum(['account', 'party']), request: z.record(z.string(), z.string()) });

/**
 * Seals a client's sign-in under way into the state pagasae carries back, under a key
 * derived from the gateway's secret. A state changed on the way, or sealed
 * under another secret, opens to nothing.
 */
export function createSignInSeals(secret: string): SignInSeals {
  const sealer = createSealer(secret, SEAL_LABEL);
  return {
    seal: (signIn) =>
      sealer.seal({ ...signIn, request: setParameters(signIn.request), expiresAt: signIn.expiresAt.toISOString() }),
    open: (state) => {
      const signIn = sealedSchema.safeParse(sealer.open(state));
      return signIn.success ? { ...signIn.data, expiresAt: new Date(signIn.data.expiresAt) } : undefined;
    },
  };
}
