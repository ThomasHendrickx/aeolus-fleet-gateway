import { beforeEach, describe, expect, it } from 'vitest';

import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, anAttioParty } from '../../../test/support/party-grant-fakes.js';
import type { SignInClient } from '../vault/credential.js';
import { createReadClientMetadataDocument } from './read-client-metadata-document.js';

const REDIRECT_URI = 'https://gateway.example.com/outside-parties/sign-in/done';
const DOCUMENT_URL = 'https://gateway.example.com/outside-oauth/clients/0d5b1f6e-8c1e-4c71-a7a1-6b4b0b1f3a22';

const DOCUMENT_CLIENT: SignInClient = {
  ...ATTIO_CLIENT,
  source: 'url',
  urlMode: 'document',
  clientId: DOCUMENT_URL,
  clientSecret: null,
  tokenEndpointAuthMethod: 'none',
};

let parties: ReturnType<typeof memoryPartyStore>;

beforeEach(() => {
  parties = memoryPartyStore();
});

function reading() {
  return createReadClientMetadataDocument({ parties, redirectUri: REDIRECT_URI });
}

describe("the gateway publishes a live party's client metadata document at its URL client id (decision 0074)", () => {
  it('answers the public document of a kept document-mode party, with its exact callback and no secret', async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: DOCUMENT_CLIENT } }));

    await expect(reading()(DOCUMENT_URL)).resolves.toEqual({
      isOk: true,
      value: {
        client_id: DOCUMENT_URL,
        client_name: 'Aeolus: attio',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
  });

  it('answers no document for an unknown URL', async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: DOCUMENT_CLIENT } }));

    await expect(reading()(`${DOCUMENT_URL}x`)).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_CLIENT_METADATA_DOCUMENT' } });
  });

  it('answers no document once the party is retired', async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: DOCUMENT_CLIENT } }));
    await parties.remove(anAttioParty().fleetId, 'attio');

    await expect(reading()(DOCUMENT_URL)).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_CLIENT_METADATA_DOCUMENT' } });
  });

  it('answers no document for a plain URL client, which claims no metadata document', async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: { ...DOCUMENT_CLIENT, urlMode: 'plain' } } }));

    await expect(reading()(DOCUMENT_URL)).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_CLIENT_METADATA_DOCUMENT' } });
  });
});
