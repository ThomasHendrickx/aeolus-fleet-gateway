import { spawn, type ChildProcess } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { aFreePort, aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { runGateway } from './support/gateway-bin.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

let fleet: FleetServer;
const started: ChildProcess[] = [];

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
});

afterAll(async () => {
  for (const child of started) {
    child.kill('SIGTERM');
  }
  await fleet.stop();
});

describe('aeolus-gateway start and migrate', () => {
  it('start migrates its database, then answers healthy', async () => {
    const port = await aFreePort();
    const child = spawn('npx', ['tsx', 'src/bin/aeolus-gateway.ts', 'start'], {
      env: { ...process.env, DATABASE_URL: aNewDatabaseUrl(inject('postgresUrl'), 'gateway'), FLEET_URL: fleet.url, PORT: String(port), LOG_LEVEL: 'silent', GATEWAY_SECRET: TEST_GATEWAY_SECRET },
      stdio: 'ignore',
    });
    started.push(child);
    await expect
      .poll(async () => fetch(`http://127.0.0.1:${String(port)}/api/health`).then((response) => response.json(), () => undefined), { timeout: 30_000 })
      .toEqual({ status: 'ok' });
  });

  it('migrate migrates a new database and exits 0', async () => {
    const { code } = await runGateway(['migrate'], { DATABASE_URL: aNewDatabaseUrl(inject('postgresUrl'), 'gateway') });
    expect(code).toBe(0);
  });

  it('migrate exits 1 with Prisma\'s account when the database does not answer', async () => {
    const { code, stderr } = await runGateway(['migrate'], { DATABASE_URL: 'postgresql://gateway:secret@127.0.0.1:9/gateway' });
    expect(code).toBe(1);
    expect(stderr).toMatch(/^The database could not be migrated\. Prisma Migrate says:\n/);
  });
});
