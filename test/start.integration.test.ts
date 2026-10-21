import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, aNewDatabaseUrl, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { runGateway, startGateway, type RunningGateway } from './support/gateway-bin.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const SIGN_IN = 'charlotte-shared-sign-in';

let fleet: FleetServer;
let pagasae: FakePagasae;
let gateway: RunningGateway | undefined;
let address: string;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  pagasae = await startFakePagasae();
  pagasae.sharedSignIn(SIGN_IN, charlotteIn(pagasae, FLEET));
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  // One gateway for the file: its web app, compiled from source, takes one Next.js development server per folder.
  gateway = startGateway({
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

  it("start answers the parties pages with the web app's, which send a person with no sign-in to sign in, and back", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);
    const pages = ['/parties', '/outside-parties', '/outside-parties/linear', '/outside-parties/linear/change', '/outside-parties/linear/retire', '/outside-parties/add'];

    const answers = await Promise.all(pages.map(async (page) => (await fetch(`${address}${page}?fleet=${FLEET}`, { headers: { accept: 'text/html' }, redirect: 'manual' })).headers.get('location')));

    expect(answers).toEqual(pages.map((page) => `/sign-in/start?return_to=${encodeURIComponent(`${page}?fleet=${FLEET}`)}`));
  }, 120_000);

  it("start sends a person with no sign-in who opens the web app's Overview to sign in, and back to it", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);

    const page = await fetch(`${address}/overview?fleet=${FLEET}`, { headers: { accept: 'text/html' }, redirect: 'manual' });

    expect(page.headers.get('location')).toBe(`/sign-in/start?return_to=${encodeURIComponent(`/overview?fleet=${FLEET}`)}`);
  }, 60_000);

  it("start shows a signed-in person the web app's Overview, read through the gateway's API as their account", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);

    const page = await fetch(`${address}/overview?fleet=${FLEET}`, { headers: { accept: 'text/html', cookie: `aeolus_account_session=${SIGN_IN}` } });
    const body = await page.text();

    expect({ status: page.status, nothing: body.includes('Nothing waits on you') }).toEqual({ status: 200, nothing: true });
  }, 60_000);

  it("start sends a browser connecting an unknown MCP client to the web app's page saying why", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);

    const page = await fetch(`${address}/authorize?response_type=code&client_id=no-such-client`, { headers: { accept: 'text/html' } });
    const body = await page.text();

    expect({ status: page.status, url: new URL(page.url).pathname, says: body.includes('The gateway does not know this MCP client') }).toEqual({ status: 200, url: '/authorize/failed', says: true });
  }, 60_000);

  it("start shows a browser whose wait the gateway does not know the web app's page saying why", async () => {
    await expect.poll(async () => fetch(`${address}/api/health`).then((response) => response.status, () => undefined), { timeout: 30_000 }).toBe(200);

    const page = await fetch(`${address}/authorize/waiting/approval?waiting=no-such-wait`, { headers: { accept: 'text/html' } });
    const body = await page.text();

    expect({ url: new URL(page.url).pathname, says: body.includes('This request is unknown, or ended long ago') }).toEqual({ url: '/authorize/failed', says: true });
  }, 60_000);

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
