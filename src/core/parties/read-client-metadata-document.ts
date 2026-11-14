/**
 * Use case: the gateway publishes a party's client metadata document at its
 * gateway URL client id (decision 0074), read by the party's authorization
 * server without any sign-in. Only a kept party whose URL client is in
 * document mode has one, so a retired party's URL answers none. The document
 * is public identity information: no person, grant, token or secret.
 */
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PartyStore } from './ports.js';

/** A client metadata document, by its OAuth field names. */
export interface ClientMetadataDocument {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly response_types: readonly string[];
  readonly token_endpoint_auth_method: 'none';
}

export type ReadClientMetadataDocument = (clientId: string) => Promise<Result<ClientMetadataDocument, DomainError<'NO_CLIENT_METADATA_DOCUMENT'>>>;

export function createReadClientMetadataDocument(deps: {
  parties: Pick<PartyStore, 'findByUrlClient'>;
  /** The exact callback every person's sign-in comes back to. */
  redirectUri: string;
}): ReadClientMetadataDocument {
  return async (clientId) => {
    const party = await deps.parties.findByUrlClient(clientId);
    const client = party?.kind === 'mcpServer' && party.credential.kind === 'personSignIn' ? party.credential.client : undefined;
    if (party === undefined || client?.source !== 'url' || client.urlMode !== 'document' || client.clientId !== clientId) {
      return refuse('NO_CLIENT_METADATA_DOCUMENT', 'No live party publishes a client metadata document here');
    }
    return ok({
      client_id: client.clientId,
      client_name: `Aeolus: ${party.name}`,
      redirect_uris: [deps.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  };
}
