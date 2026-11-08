/**
 * pagasae as core meets it in a test (decision 0058): a key set core fetches
 * from the issuer's URL, and account tokens signed with its key. Core trusts
 * an issuer only by the key set it publishes.
 */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface AccountIssuer {
  /** The URL core fetches the key set from, and the `iss` of each token. */
  issuer: string;
  /** An account token for one account in one fleet, ending in 10 minutes. */
  tokenFor(account: { accountId: string; fleetId: string; scopes: readonly string[] }): string;
  close(): Promise<void>;
}

const TOKEN_SECONDS = 600;
const MILLISECONDS_PER_SECOND = 1000;

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export async function startAccountIssuer(): Promise<AccountIssuer> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = randomUUID();
  const keySet = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: keyId, alg: 'EdDSA', use: 'sig' }] };
  const server: Server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(keySet));
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const bound = server.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('the key set server listens on no port');
  }
  const issuer = `http://127.0.0.1:${String(bound.port)}`;
  return {
    issuer,
    tokenFor: ({ accountId, fleetId, scopes }) => {
      const now = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
      const claims = { iss: issuer, aud: fleetId, sub: accountId, org: 'org-test', scope: scopes.join(' '), group: [], iat: now, exp: now + TOKEN_SECONDS };
      const input = `${encoded({ alg: 'EdDSA', typ: 'at+jwt', kid: keyId })}.${encoded(claims)}`;
      return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
    },
    close: () =>
      new Promise<void>((closed) => {
        server.close(() => {
          closed();
        });
      }),
  };
}
