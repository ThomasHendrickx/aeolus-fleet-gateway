import type { FleetId } from '@aeolus-fleet/common';

import type { OAuthSecrets } from '../oauth/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { IdentityProviders, ProviderDiscovery, ProviderSignIn, SignIns } from './ports.js';
import type { SignedInPerson } from './sign-in.js';

export type CompleteSignIn = (callback: { state?: string; code?: string; error?: string }) => Promise<
  Result<{ fleetId: FleetId; person: SignedInPerson; request: Readonly<Record<string, string>> }, { readonly kind: 'signInRefused'; readonly message: string }>
>;

const refused = (message: string) => err({ kind: 'signInRefused' as const, message });

/**
 * Use case: a person comes back from the fleet's identity provider. The
 * sign-in is taken by its state, once and within ten minutes, so a sign-in
 * is never completed twice or by a forged answer; then the provider's code
 * is taken for an ID token, checked against the sign-in's nonce. The person
 * is who the provider vouched for, with their MCP client's request.
 */
export function createCompleteSignIn(deps: {
  signIns: SignIns;
  providers: IdentityProviders;
  discovery: ProviderDiscovery;
  providerSignIn: ProviderSignIn;
  secrets: OAuthSecrets;
  clock: Clock;
  callbackUrl: string;
}): CompleteSignIn {
  return async ({ state, code, error }) => {
    if (state === undefined || state === '') {
      return refused('The identity provider sent you back with no state: start again from your MCP client');
    }
    const signIn = await deps.signIns.take(deps.secrets.hashOf(state));
    if (!signIn) {
      return refused('No sign-in is under way for this answer, or it was completed already: start again from your MCP client');
    }
    if (signIn.expiresAt.getTime() <= deps.clock.now().getTime()) {
      return refused('The sign-in took over 10 minutes: start again from your MCP client');
    }
    if (error !== undefined) {
      return refused(`The identity provider did not sign you in: ${error}`);
    }
    if (code === undefined || code === '') {
      return refused('The identity provider sent you back with no code: start again from your MCP client');
    }
    const provider = await deps.providers.find(signIn.fleetId);
    if (!provider) {
      return refused('The fleet has no identity provider any more: ask argo');
    }
    const metadata = await deps.discovery.discover(provider.issuer);
    if (!metadata.isOk) {
      return refused(`The gateway could not read ${provider.issuer}'s OpenID configuration: ${metadata.error.reason}`);
    }
    const person = await deps.providerSignIn.complete({ provider, metadata: metadata.value, code, redirectUri: deps.callbackUrl, verifier: signIn.verifier, nonce: signIn.nonce });
    if (!person.isOk) {
      return refused(`The identity provider's answer could not be checked: ${person.error.reason}`);
    }
    return ok({ fleetId: signIn.fleetId, person: person.value, request: signIn.request });
  };
}
