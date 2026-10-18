import { createHash, randomBytes } from 'node:crypto';

import type { OAuthSecrets } from '../../core/oauth/ports.js';

/** 256 bits for each code, token and client secret. */
const SECRET_BYTES = 32;

/** Secrets drawn from the system's random source, kept as SHA-256 in hex; S256 as RFC 7636 defines it. */
export const oauthSecrets: OAuthSecrets = {
  newSecret: () => randomBytes(SECRET_BYTES).toString('base64url'),
  hashOf: (secret) => createHash('sha256').update(secret).digest('hex'),
  challengeOf: (verifier) => createHash('sha256').update(verifier, 'ascii').digest('base64url'),
};
