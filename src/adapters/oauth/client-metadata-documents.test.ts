import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createClientMetadataDocuments } from './client-metadata-documents.js';

const DOCUMENT = { client_id: 'placeholder', client_name: 'Claude', redirect_uris: ['http://127.0.0.1/callback'] };

let server: Server;
let base: string;

beforeEach(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case '/client.json':
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(DOCUMENT));
        return;
      case '/large.json':
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...DOCUMENT, padding: 'x'.repeat(6000) }));
        return;
      case '/moved.json':
        response.writeHead(302, { location: '/client.json' }).end();
        return;
      case '/slow.json':
        setTimeout(() => response.writeHead(200).end('{}'), 500);
        return;
      case undefined:
      default:
        response.writeHead(404).end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const documents = createClientMetadataDocuments({ timeoutMs: 200 });

describe("a client's metadata document, fetched from its client id (CIMD)", () => {
  it('reads it as JSON', async () => {
    await expect(documents.fetch(`${base}/client.json`)).resolves.toEqual({ isOk: true, value: DOCUMENT });
  });

  it.each([
    ['a document over 5 KB', '/large.json'],
    ['a redirect, which is not followed', '/moved.json'],
    ['an answer that is not OK', '/missing.json'],
    ['no answer within the timeout', '/slow.json'],
  ])('refuses %s', async (_what, path) => {
    await expect(documents.fetch(`${base}${path}`)).resolves.toMatchObject({ isOk: false });
  });
});
