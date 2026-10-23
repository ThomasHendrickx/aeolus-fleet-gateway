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
