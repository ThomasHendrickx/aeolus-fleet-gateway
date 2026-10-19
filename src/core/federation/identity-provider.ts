/**
 * The fleet's company identity provider (interop I-4): the OpenID provider
 * people sign in with, so leavers lose access when the company drops them.
 * argo sets one per fleet; its client secret is kept in the vault, the
 * gateway's own database, as the parties' credentials are.
 */
import type { FleetId } from '@aeolus-fleet/common';

import { isLoopback } from '../oauth/redirect-uri.js';

export interface IdentityProvider {
  fleetId: FleetId;
  /** The provider's issuer, as its OpenID configuration and its ID tokens name it. */
  issuer: string;
  /** The gateway's client at the provider, and its secret. */
  clientId: string;
  clientSecret: string;
  setAt: Date;
}

/** What argo and the page read of it: never its secret. */
export interface ShownIdentityProvider {
  issuer: string;
  clientId: string;
  setAt: Date;
}

/** An identity provider's OpenID configuration, as far as the gateway uses it (OpenID Connect Discovery 1.0). */
export interface ProviderMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

export function shownIdentityProvider(provider: IdentityProvider): ShownIdentityProvider {
  return { issuer: provider.issuer, clientId: provider.clientId, setAt: provider.setAt };
}

/** A URL a person's sign-in may go through: https, or http on this machine, as a local provider is served. */
export function isSecureUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));
}

/** An issuer argo may set: a secure URL with no query or fragment (OpenID Connect Discovery 2). */
export function isIssuer(text: string): boolean {
  return isSecureUrl(text) && !text.includes('?') && !text.includes('#');
}
