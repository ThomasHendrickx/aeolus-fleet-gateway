import type { FleetId } from '@aeolus-fleet/common';

import type { OAuthSecrets } from '../oauth/ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from '../oauth/read-authorization.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { IdentityProviders, ProviderDiscovery, SignIns } from './ports.js';
import { SIGN_IN_LIFETIME_MS } from './sign-in.js';

/** Why a sign-in could not start, beside the client's request's own refusals. */
export type StartSignInRefusal = AuthorizationRefusal | { readonly kind: 'noIdentityProvider' } | { readonly kind: 'providerUnusable'; readonly message: string };

export type StartSignIn = (request: Readonly<Record<string, string | undefined>>) => Promise<Result<{ redirectTo: string }, StartSignInRefusal>>;

/** What the gateway asks the provider for: who the person is, and their email. */
const SCOPE = 'openid email';

/** The request's fields that were sent, as they are kept. */
function sentFields(request: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(request).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/**
 * Use case: a person, come to /authorize from their MCP client with no
 * console session, starts signing in at the identity provider of the fleet
 * whose MCP endpoint the client asks for (Q25). The client's request is read
 * as /authorize reads it; the gateway then sends the person to the provider
 * with the code flow, PKCE, a state and a nonce (OpenID Connect Core 3.1),
 * keeping the sign-in for ten minutes.
 */
export function createStartSignIn(deps: {
  readAuthorization: ReadAuthorization;
  providers: IdentityProviders;
  discovery: ProviderDiscovery;
  signIns: SignIns;
  secrets: OAuthSecrets;
  clock: Clock;
  /** Where the provider sends the person back: the redirect URI argo registered there. */
  callbackUrl: string;
}): StartSignIn {
  const providerOf = async (fleetId: FleetId) => {
    const provider = await deps.providers.find(fleetId);
    if (!provider) {
      return err({ kind: 'noIdentityProvider' as const });
    }
    const metadata = await deps.discovery.discover(provider.issuer);
    return metadata.isOk ? ok({ provider, metadata: metadata.value }) : err({ kind: 'providerUnusable' as const, message: `The gateway could not read ${provider.issuer}'s OpenID configuration: ${metadata.error.reason}` });
  };

  return async (request) => {
    const read = await deps.readAuthorization(request);
    if (!read.isOk) {
      return read;
    }
    const found = await providerOf(read.value.fleetId);
    if (!found.isOk) {
      return found;
    }
    const { provider, metadata } = found.value;
    const state = deps.secrets.newSecret();
    const nonce = deps.secrets.newSecret();
    const verifier = deps.secrets.newSecret();
    await deps.signIns.save({ stateHash: deps.secrets.hashOf(state), fleetId: read.value.fleetId, request: sentFields(request), verifier, nonce, expiresAt: new Date(deps.clock.now().getTime() + SIGN_IN_LIFETIME_MS) });
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: deps.callbackUrl,
      scope: SCOPE,
      state,
      nonce,
      code_challenge: deps.secrets.challengeOf(verifier),
      code_challenge_method: 'S256',
    });
    const separator = metadata.authorizationEndpoint.includes('?') ? '&' : '?';
    return ok({ redirectTo: `${metadata.authorizationEndpoint}${separator}${query.toString()}` });
  };
}
