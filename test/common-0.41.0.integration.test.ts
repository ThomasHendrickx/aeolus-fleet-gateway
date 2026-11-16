import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createArgoInboxDoor } from '../src/adapters/fleet/argo-inbox-door.js';
import { applyEmptyOwnRules, argoShipId, commission, letReadArgo, register, signIn } from './support/argo.js';
import { common041Environment } from './support/common-0.41.0.js';
import { PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { startGateway, type RunningGateway } from './support/gateway-bin.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { send } from './support/ship.js';

// The gateway on @aeolus-fleet/common 0.41.0, the common core 0.41.0 answers
// by (long-poll W8: no call waits), against the core production runs: it
// starts, and follows argo's inbox without a wait.

const run = promisify(execFile);

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const START_TIMEOUT_MS = 30_000;

let fleet: FleetServer;
let pagasae: FakePagasae;
let gateway: RunningGateway | undefined;
let address: string;
let common041: Record<string, string>;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  pagasae = await startFakePagasae();
  common041 = await common041Environment();
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  gateway = startGateway({
    ...common041,
    DATABASE_URL: aNewDatabaseUrl(inject('postgresUrl'), 'gateway'),
    FLEET_URL: fleet.url,
    PORT: String(port),
    LOG_LEVEL: 'silent',
    GATEWAY_SECRET: TEST_GATEWAY_SECRET,
    PAGASAE_URL: pagasae.url,
    PAGASAE_CLIENT_ID: PAGASAE_CLIENT.clientId,
    PAGASAE_CLIENT_SECRET: PAGASAE_CLIENT.clientSecret,
    PAGASAE_APP_CLIENT_ID: PAGASAE_APP_CLIENT.clientId,
    PAGASAE_APP_CLIENT_SECRET: PAGASAE_APP_CLIENT.clientSecret,
  });
});

afterAll(async () => {
  await gateway?.stop();
  await fleet.stop();
  await pagasae.stop();
});

describe('the gateway on common 0.41.0', () => {
  it('starts and answers healthy', async () => {
    await expect
      .poll(async () => fetch(`${address}/api/health`).then((response) => response.json(), () => undefined), { timeout: START_TIMEOUT_MS })
      .toEqual({ status: 'ok' });
  }, 60_000);

  it("follows argo's inbox: the message a new send to argo concerns", async () => {
    const cookie = await signIn(fleet);
    const argo: ShipId = await argoShipId(fleet, cookie);
    const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
    const crewToken = await register(fleet, gatewayShip);
    const trierarch = await register(fleet, await commission(fleet, { cookie, ship: { name: 'trierarch', type: 'trierarch', scopes: ['messages:send'] } }));
    await applyEmptyOwnRules(fleet, cookie);
    await letReadArgo(fleet, { cookie, readerShipId: gatewayShip.shipId });
    const position = await createArgoInboxDoor({ fleetUrl: fleet.url }).position(crewToken);
    const messageId = await send(fleet, { crewToken: trierarch, to: argo, contentType: 'text/markdown', payload: 'formation recovery given up' });

    const { stdout } = await run('npx', ['tsx', 'test/support/follow-argo-inbox-once.ts', fleet.url, crewToken, argo, String(position.isOk ? position.value : -1)], {
      env: { ...process.env, ...common041 },
    });

    expect(JSON.parse(stdout)).toMatchObject({ isOk: true, value: { changes: [{ messageId }] } });
  }, 60_000);
});
