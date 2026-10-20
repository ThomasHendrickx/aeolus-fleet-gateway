import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { z } from 'zod';

import type { SignInSeals } from '../../core/sign-in/ports.js';

/** Its own label, so the sealing key is never also a key the gateway derives elsewhere. */
const SEAL_LABEL = 'sign-in-seal';
const CIPHER = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const sealedSchema = z.object({
  verifier: z.string(),
  request: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});

/**
 * Seals a sign-in under way with AES-256-GCM, under a key derived from the
 * gateway's secret: the state pagasae carries back is the nonce, the sealed
 * sign-in and its tag, base64url. A state changed on the way, or sealed under
 * another secret, opens to nothing.
 */
export function createSignInSeals(secret: string): SignInSeals {
  const key = createHmac('sha256', secret).update(SEAL_LABEL).digest();
  return {
    seal: ({ verifier, request, expiresAt }) => {
      const kept = Object.fromEntries(Object.entries(request).filter((entry): entry is [string, string] => entry[1] !== undefined));
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(CIPHER, key, nonce);
      const sealed = Buffer.concat([cipher.update(JSON.stringify({ verifier, request: kept, expiresAt: expiresAt.toISOString() }), 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, sealed, cipher.getAuthTag()]).toString('base64url');
    },
    open: (state) => {
      const bytes = Buffer.from(state, 'base64url');
      if (bytes.length <= NONCE_BYTES + TAG_BYTES) {
        return undefined;
      }
      const decipher = createDecipheriv(CIPHER, key, bytes.subarray(0, NONCE_BYTES));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
      let opened: string;
      try {
        opened = Buffer.concat([decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)), decipher.final()]).toString('utf8');
      } catch {
        return undefined;
      }
      const signIn = sealedSchema.safeParse(JSON.parse(opened));
      return signIn.success ? { ...signIn.data, expiresAt: new Date(signIn.data.expiresAt) } : undefined;
    },
  };
}
