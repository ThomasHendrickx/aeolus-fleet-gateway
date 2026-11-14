import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, anAttioParty } from '../../../test/support/party-grant-fakes.js';
import { createReadClientMetadataDocument } from '../../core/parties/read-client-metadata-document.js';
import { registerClientMetadataDocumentRoutes, urlClientIdOf } from './client-metadata-document-routes.js';

const PUBLIC_URL = 'https://gateway.example.com';
const REDIRECT_URI = 'https://gateway.example.com/outside-parties/sign-in/done';
const OPAQUE_ID = '0d5b1f6e-8c1e-4c71-a7a1-6b4b0b1f3a22';
const DOCUMENT_URL = `https://gateway.example.com/outside-oauth/clients/${OPAQUE_ID}`;

let server: FastifyInstance;
let parties: ReturnType<typeof memoryPartyStore>;

beforeEach(async () => {
  parties = memoryPartyStore();
  server = Fastify();
  registerClientMetadataDocumentRoutes(server, { read: createReadClientMetadataDocument({ parties, redirectUri: REDIRECT_URI }), publicUrl: PUBLIC_URL });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

describe("a party's client metadata document at its exact URL client id (decision 0074)", () => {
  it('allocates URL client ids beneath the public address, each distinct', () => {
    const allocated = [urlClientIdOf(PUBLIC_URL)(), urlClientIdOf(PUBLIC_URL)()];

    expect(allocated[0]).toMatch(/^https:\/\/gateway\.example\.com\/outside-oauth\/clients\/[0-9a-f-]{36}$/);
    expect(allocated[0]).not.toBe(allocated[1]);
  });

  it('serves the public JSON document without any sign-in', async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: { ...ATTIO_CLIENT, source: 'url', urlMode: 'document', clientId: DOCUMENT_URL, clientSecret: null, tokenEndpointAuthMethod: 'none' } } }));

    const answer = await server.inject({ url: `/outside-oauth/clients/${OPAQUE_ID}` });

    expect({ status: answer.statusCode, type: answer.headers['content-type'], body: answer.json<unknown>() }).toEqual({
      status: 200,
      type: 'application/json; charset=utf-8',
      body: {
        client_id: DOCUMENT_URL,
        client_name: 'Aeolus: attio',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
  });

  it('answers not found where no live party publishes a document', async () => {
    const answer = await server.inject({ url: `/outside-oauth/clients/${OPAQUE_ID}` });

    expect(answer.statusCode).toBe(404);
  });
});
