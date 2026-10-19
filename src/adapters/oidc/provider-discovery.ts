/**
 * Identity providers' OpenID configurations (OpenID Connect Discovery 1.0),
 * read from `<issuer>/.well-known/openid-configuration` with a short timeout
 * and no redirect followed: the issuer names where its configuration is.
 */
import { z } from 'zod';

import type { ProviderDiscovery } from '../../core/federation/ports.js';
import { err, ok } from '../../core/shared/result.js';

const HTTP_OK = 200;

/** The fields the gateway uses; a provider states many more. */
const configurationSchema = z.object({ issuer: z.string(), authorization_endpoint: z.string(), token_endpoint: z.string(), jwks_uri: z.string() });

/** Where an issuer's configuration is: its path, with any trailing slash, then the well-known suffix (Discovery 4). */
const configurationUrlOf = (issuer: string) => `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;

export function createProviderDiscovery(options: { timeoutMs: number }): ProviderDiscovery {
  return {
    discover: async (issuer) => {
      try {
        const response = await fetch(configurationUrlOf(issuer), { redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs), headers: { accept: 'application/json' } });
        if (response.status !== HTTP_OK) {
          return err({ reason: `it answered ${String(response.status)}` });
        }
        const parsed = configurationSchema.safeParse(await response.json());
        if (!parsed.success) {
          return err({ reason: 'it lacks an issuer, an authorization or token endpoint, or keys' });
        }
        const { issuer: named, authorization_endpoint, token_endpoint, jwks_uri } = parsed.data;
        return ok({ issuer: named, authorizationEndpoint: authorization_endpoint, tokenEndpoint: token_endpoint, jwksUri: jwks_uri });
      } catch (error) {
        return err({ reason: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
