/**
 * The credential the gateway calls an outside MCP server or A2A agent with, kept in the
 * vault, the gateway's own database (as squadrons keeps crew tokens). The
 * server sees the gateway's credential, never the asker's: no rights travel
 * with a message.
 */
export type McpServerCredential =
  /** A server that asks for none, as one reached only on a private network: the gateway sends no Authorization header. */
  | { readonly kind: 'none' }
  | { readonly kind: 'bearer'; readonly token: string }
  | {
      readonly kind: 'clientCredentials';
      readonly clientId: string;
      readonly clientSecret: string;
      /** The authorization server's issuer: the credential goes to no other. */
      readonly issuer: string;
      /** The OAuth scope to ask the authorization server for, if the server needs one. */
      readonly scope?: string;
    };

/**
 * The OAuth client the gateway registered for one party with the outside
 * authorization server, by dynamic registration (decision 0067): every
 * person's grant for the party is under it, and it goes to no issuer but its
 * own.
 */
export interface SignInClient {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** Where a grant is revoked, when the authorization server offers it. */
  readonly revocationEndpoint: string | null;
  /** Whether the authorization server states its issuer in each authorization response (RFC 9207): a response without it is then refused. */
  readonly isIssuerInResponse: boolean;
  readonly clientId: string;
  /** None when the authorization server registered a public client. */
  readonly clientSecret: string | null;
  /** Where the client is read or deleted, and with what (RFC 7592), when the authorization server answered them; only registration answers them. */
  readonly registrationClientUri: string | null;
  readonly registrationAccessToken: string | null;
  /** The server's resource indicator (RFC 8707), as its protected resource metadata names it. */
  readonly resource: string;
  /** The outside scopes each person's sign-in asks for. */
  readonly scope: string;
}

/**
 * An outside MCP server's credential: one of the gateway's own, or, for a
 * server that takes only an OAuth sign-in, the party's client, under which
 * each person signs in for themselves (decision 0067).
 */
export type McpServerPartyCredential = McpServerCredential | { readonly kind: 'personSignIn'; readonly client: SignInClient };
