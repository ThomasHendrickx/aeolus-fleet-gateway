import { spawn, type ChildProcess } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { aFreePort, aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { runGateway } from './support/gateway-bin.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

let fleet: FleetServer;
let gateway: ChildProcess | undefined;
let address: string;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  // One gateway for the file: its web app, compiled from source, takes one Next.js development server per folder.
  gateway = spawn('npx', ['tsx', 'src/bin/aeolus-gateway.ts', 'start'], {
    env: { ...process.env, DATABASE_URL: aNewDatabaseUrl(inject('postgresUrl'), 'gateway'), FLEET_URL: fleet.url, PORT: String(port), LOG_LEVEL: 'silent', GATEWAY_SECRET: TEST_GATEWAY_SECRET },
    stdio: 'ignore',
  });
});

afterAll(async () => {
  gateway?.kill('SIGTERM');
  await fleet.stop();
});

describe('aeolus-gateway start and migrate', () => {
  it('start migrates its database, then answers healthy', async () => {
    await expect
      .poll(async () => fetch(`${address}/api/health`).then((response) => response.json(), () => undefined), { timeout: 30_000 })
      .toEqual({ status: 'ok' });
  });

  it("start answers an unknown page with the web app's Not found, in its frame", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);

    const page = await fetch(`${address}/no-such-page`, { headers: { accept: 'text/html' } });
    const body = await page.text();

    expect(page.status).toBe(404);
    expect(body).toContain('This page does not exist');
    expect(body).toContain('data-testid="frame-header"');
    expect(body).toContain('href="/overview"');
  }, 60_000);

  it("start answers a sign-in that did not go through with the web app's page saying why, and the way to sign in again", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);

    const page = await fetch(`${address}/sign-in/failed?reason=otherBrowser`, { headers: { accept: 'text/html' } });
    const body = await page.text();

    expect(page.status).toBe(200);
    expect(body).toContain('This sign-in was started in another browser');
    expect(body).toContain('href="/sign-in/start"');
  }, 60_000);

  it("start answers the parties pages with the web app's, which say a gateway that is no app at pagasae signs no one in", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);
    const pages = ['/parties', '/outside-parties', '/outside-parties/linear', '/outside-parties/linear/change', '/outside-parties/linear/retire', '/outside-parties/add'];

    const answers = await Promise.all(pages.map(async (page) => (await fetch(`${address}${page}`, { headers: { accept: 'text/html' } })).text()));

    expect(answers.map((body) => body.includes('data-testid="frame-header"') && body.includes('signs no one in'))).toEqual(pages.map(() => true));
  }, 120_000);

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
