/**
 * A person's sign-in at the fleet's company identity provider (interop I-4),
 * while it is under way: the gateway sent them to the provider with a state,
 * a nonce and a PKCE challenge, and keeps what it needs to check them when
 * they come back, with their MCP client's own request to go on with.
 */
import type { FleetId } from '@aeolus-fleet/common';

/** How long a person may take at the provider: ten minutes, as a person signs in. */
export const SIGN_IN_LIFETIME_MS = 600_000;

export interface SignIn {
  /** The state sent to the provider, kept only as its hash. */
  stateHash: string;
  fleetId: FleetId;
  /** The MCP client's authorization request, as it came to /authorize. */
  request: Readonly<Record<string, string>>;
  /** The PKCE verifier and the nonce of the gateway's own request to the provider. */
  verifier: string;
  nonce: string;
  expiresAt: Date;
}

/** Who the provider vouched for: its issuer and subject, and the email only when the provider verified it. */
export interface SignedInPerson {
  issuer: string;
  subject: string;
  email: string | null;
}
