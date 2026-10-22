import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { requireCoreVersion } from '../src/adapters/fleet/core-version.js';
import { aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { runGateway } from './support/gateway-bin.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

let fleet: FleetServer;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
});

afterAll(async () => {
  await fleet.stop();
});

describe('the gateway against a real core (decision 0049)', () => {
  it('reads the version core says and starts', async () => {
    await expect(requireCoreVersion(fleet.url)).resolves.toBeUndefined();
  });

  it('exits 1 before it listens when the fleet does not answer, naming its version and the minimum', async () => {
    const { code, stderr } = await runGateway(['start'], { DATABASE_URL: aNewDatabaseUrl(inject('postgresUrl'), 'gateway'), FLEET_URL: 'http://127.0.0.1:9', PORT: '0', GATEWAY_SECRET: TEST_GATEWAY_SECRET });
    expect(code).toBe(1);
    expect(stderr).toMatch(/^gateway 0\.0\.0 needs core 0\.29\.0 or later, and could not read the version of the fleet at http:\/\/127\.0\.0\.1:9: /);
  });
});
