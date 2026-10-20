import { auth } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { PAGASAE_CLIENT, startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { aClientProvider, aCrewedClientParty, aRegisteredClient, answered, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';

// An MCP client signs in to the gateway with the MCP TypeScript SDK, as
// Claude or Cursor would: argo pre-registers it, a person of the fleet asks
// for access for it at /authorize, its party answers, and the client takes
// its code for tokens.

let setting: Setting;
let app: GatewayApp;

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae: await startFakePagasae() };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET, pagasae: { url: setting.pagasae.url, ...PAGASAE_CLIENT } });
  await app.server.listen({ host: '127.0.0.1', port });
});

afterEach(async () => {
  await app.close();
  await setting.pagasae.stop();
  await setting.fleet.stop();
});

describe('an MCP client signs in to the gateway with the MCP TypeScript SDK', () => {
  it.each([
    ['a confidential client', true],
    ['a public client', false],
  ])('%s gets tokens as its party', async (_what, isConfidential) => {
    const information = await aRegisteredClient(setting, isConfidential);
    await aCrewedClientParty(setting, information.clientId);
    const client = aClientProvider(information);
    const serverUrl = `${setting.address}/mcp`;

    await expect(auth(client.provider, { serverUrl })).resolves.toBe('REDIRECT');
    const { code, iss } = await answered(setting, z.instanceof(URL).parse(client.sentTo()));
    await expect(auth(client.provider, { serverUrl, authorizationCode: code, ...(iss === null ? {} : { iss }) })).resolves.toBe('AUTHORIZED');

    expect(client.tokens()).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
  });
});
