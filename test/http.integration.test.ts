import { afterEach, describe, expect, inject, it } from 'vitest';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { aNewDatabaseUrl } from './support/fleet-server.js';
import { migratedDatabase } from './support/database.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

let app: GatewayApp | undefined;

afterEach(async () => {
  await app?.close();
});

describe('the gateway answers whoever operates the installation', () => {
  it('answers its version, and nothing about its database or fleets', async () => {
    app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: 'http://127.0.0.1:9', logger: false });
    const response = await app.server.inject({ method: 'GET', url: '/api/version' });
    expect(response.json()).toEqual({ gateway: '0.0.0' });
  });

  it('answers healthy while its database answers', async () => {
    app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: 'http://127.0.0.1:9', logger: false });
    const response = await app.server.inject({ method: 'GET', url: '/api/health' });
    expect({ status: response.statusCode, body: response.json<unknown>() }).toEqual({ status: 200, body: { status: 'ok' } });
  });

  it('answers unavailable while its database does not answer', async () => {
    app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl: aNewDatabaseUrl(inject('postgresUrl'), 'never_created'), fleetUrl: 'http://127.0.0.1:9', logger: false });
    const response = await app.server.inject({ method: 'GET', url: '/api/health' });
    expect({ status: response.statusCode, body: response.json<unknown>() }).toEqual({ status: 503, body: { status: 'unavailable' } });
  });
});
