/**
 * An outside MCP server's credential, as the add, Parties and decision forms
 * take it: none for a server reached only on a private network, a static
 * bearer, or OAuth client credentials. A server being added may instead
 * have each person sign in to it for themselves (decision 0067).
 */

/** The credential kinds a form offers, with the words it shows. */
export const CREDENTIAL_KINDS = [
  { kind: 'none', label: 'No credential' },
  { kind: 'bearer', label: 'Bearer token' },
  { kind: 'clientCredentials', label: 'OAuth client credentials' },
] as const;

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number]['kind'];

export type ServerCredential =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'clientCredentials'; clientId: string; clientSecret: string; issuer: string; scope?: string };

/** The kind only adding a server offers: the gateway registers the party's client, and each person signs in (decision 0067). */
export const SIGN_IN_CREDENTIAL = { kind: 'personSignIn', label: 'Each person signs in' } as const;

/** The credential kinds the add page offers, with the words it shows. */
export const ADDED_CREDENTIAL_KINDS = [...CREDENTIAL_KINDS, SIGN_IN_CREDENTIAL] as const;

export type AddedCredentialKind = (typeof ADDED_CREDENTIAL_KINDS)[number]['kind'];

export type AddedServerCredential = ServerCredential | { kind: typeof SIGN_IN_CREDENTIAL.kind };

/** The kind a form sent, a bearer when it sent none it knows. */
export function credentialKindOf(sent: string): CredentialKind {
  return CREDENTIAL_KINDS.find(({ kind }) => kind === sent)?.kind ?? 'bearer';
}

/** The credential the fields name: only the fields of its kind are read. */
export function serverCredentialOf(fields: { credentialKind: string; token: string; clientId: string; clientSecret: string; issuer: string; scope: string }): ServerCredential {
  const kind = credentialKindOf(fields.credentialKind);
  switch (kind) {
    case 'none':
      return { kind };
    case 'bearer':
      return { kind, token: fields.token };
    case 'clientCredentials':
      return { kind, clientId: fields.clientId, clientSecret: fields.clientSecret, issuer: fields.issuer, ...(fields.scope === '' ? {} : { scope: fields.scope }) };
  }
}

/** The kind the add page sent, a bearer when it sent none it knows. */
export function addedCredentialKindOf(sent: string): AddedCredentialKind {
  return ADDED_CREDENTIAL_KINDS.find(({ kind }) => kind === sent)?.kind ?? 'bearer';
}

/** The credential the add page's fields name: each person signing in takes no field. */
export function addedServerCredentialOf(fields: Parameters<typeof serverCredentialOf>[0]): AddedServerCredential {
  return addedCredentialKindOf(fields.credentialKind) === SIGN_IN_CREDENTIAL.kind ? { kind: SIGN_IN_CREDENTIAL.kind } : serverCredentialOf(fields);
}
