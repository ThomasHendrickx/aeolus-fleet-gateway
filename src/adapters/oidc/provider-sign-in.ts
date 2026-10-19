/**
 * The provider's side of a person's sign-in (OpenID Connect Core 3.1.3):
 * the code is taken at the provider's token endpoint with the gateway's
 * client secret and the PKCE verifier, and the ID token is checked with
 * jose against the provider's published keys: its signature, issuer,
 * audience (the gateway's client), expiry, and the sign-in's nonce.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

import type { ProviderSignIn } from '../../core/federation/ports.js';
import { err, ok } from '../../core/shared/result.js';

const HTTP_OK = 200;

const tokenAnswerSchema = z.object({ id_token: z.string() });
const claimsSchema = z.object({ sub: z.string().min(1), nonce: z.string().optional(), email: z.string().optional(), email_verified: z.boolean().optional() });

export function createProviderSignIn(options: { timeoutMs: number }): ProviderSignIn {
  return {
    complete: async ({ provider, metadata, code, redirectUri, verifier, nonce }) => {
      try {
        const response = await fetch(metadata.tokenEndpoint, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs),
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: provider.clientId, client_secret: provider.clientSecret, code_verifier: verifier }).toString(),
        });
        if (response.status !== HTTP_OK) {
          return err({ reason: `its token endpoint answered ${String(response.status)}` });
        }
        const answer = tokenAnswerSchema.safeParse(await response.json());
        if (!answer.success) {
          return err({ reason: 'its token endpoint answered no ID token' });
        }
        const keys = createRemoteJWKSet(new URL(metadata.jwksUri), { timeoutDuration: options.timeoutMs });
        const { payload } = await jwtVerify(answer.data.id_token, keys, { issuer: provider.issuer, audience: provider.clientId });
        const claims = claimsSchema.safeParse(payload);
        if (!claims.success || claims.data.nonce !== nonce) {
          return err({ reason: 'its ID token names no subject, or another sign-in' });
        }
        const { sub, email, email_verified: isEmailVerified } = claims.data;
        return ok({ issuer: provider.issuer, subject: sub, email: isEmailVerified === true && email !== undefined ? email : null });
      } catch (error) {
        return err({ reason: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
