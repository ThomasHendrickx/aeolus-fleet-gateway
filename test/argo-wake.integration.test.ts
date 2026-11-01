import type { FleetId, ShipId } from '@aeolus-fleet/common';
import webPush from 'web-push';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaRoutes } from '../src/adapters/prisma/routes.js';
import { createPrismaWebPushSubscriptions } from '../src/adapters/prisma/web-push-subscriptions.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { applyEmptyOwnRules, argoShipId, commission, letReadArgo, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { aWebPushSubscription } from './support/people-fakes.js';
import { startPushService } from './support/push-service.js';
import { send } from './support/ship.js';

// What waits at argo wakes a person allowed as argo with a wake of its own
// (argo's inbox, AI4, AI5, section 4, the trierarch's happy path): the
// gateway's ship reads argo's inbox by argo's read rule, and the person's
// browser is told that something waits at argo, with no content. The fleet,
// the gateway and the push service are real servers; pagasae is a fake.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const SIGN_IN = 'charlotte-allowed-as-argo';
const WOKEN_WITHIN_MS = 20_000;
const FIREFOX = '/firefox';

let fleet: FleetServer;
let pagasae: FakePagasae;
let pushService: Awaited<ReturnType<typeof startPushService>>;
let app: GatewayApp;
let prisma: PrismaClient;
let address: string;
let fleetId: FleetId;
let argo: ShipId;
let trierarch: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  argo = await argoShipId(fleet, cookie);
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  trierarch = await register(fleet, await commission(fleet, { cookie, ship: { name: 'trierarch', type: 'trierarch', scopes: ['messages:send'] } }));
  const who = await createRestFleetDoor(fleet.url).whoami(await register(fleet, charlotte));
  if (!who.isOk) {
    throw new Error('charlotte is not crewed');
  }
  fleetId = who.value.fleetId;
  await applyEmptyOwnRules(fleet, cookie);
  await letReadArgo(fleet, { cookie, readerShipId: gatewayShip.shipId });
  const databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
  // Charlotte turned web push on in one browser, for everything else, the job of the trierarch's plain reports (Bridge, section 8).
  await createPrismaRoutes(prisma).save({ fleetId, shipId: charlotte.shipId, job: 'everything-else', place: 'web-push', isOn: true, changedAt: new Date('2026-11-01T00:00:00.000Z') });
  pushService = await startPushService();
  const browser = pushService.browser(FIREFOX);
  await createPrismaWebPushSubscriptions(prisma).save(aWebPushSubscription({ fleetId, shipId: charlotte.shipId, endpoint: browser.endpoint, keys: browser.keys, fleetName: 'Aeolus fleet' }));
  pagasae = await startFakePagasae();
  pagasae.sharedSignIn(SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: charlotte.shipId, argo: true });
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  const keys = webPush.generateVAPIDKeys();
  app = createGatewayApp({
    databaseUrl,
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: address,
    gatewaySecret: TEST_GATEWAY_SECRET,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
    webPush: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:ops@example.com' },
    // The tests' push service listens on this machine, which no real push service does.
    isAllowedPushAddress: (pushAddress) => pushAddress === '127.0.0.1',
  });
  await app.server.listen({ host: '127.0.0.1', port });
  await app.restoreConnections();
  const connected = await connectGateway(address, { cookie, ...gatewayShip });
  expect(connected.status, await connected.clone().text()).toBe(200);
  // Charlotte signs in: her account token says she is allowed as argo (AI9).
  const read = await fetch(`${address}/trpc/people.argoInboxNotice`, { headers: { cookie: `aeolus_account_session=${SIGN_IN}`, 'aeolus-fleet': fleetId } });
  expect(read.status).toBe(200);
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await pushService.stop();
  await pagasae.stop();
  await fleet.stop();
});

describe('a person allowed as argo, as the trierarch reports to argo', () => {
  it('is woken in their browser with a wake of its own: something waits at argo, with no content', async () => {
    await send(fleet, { crewToken: trierarch, to: argo, contentType: 'text/plain', payload: 'thomas-mac is low on disk: 4% free' });

    await expect.poll(() => pushService.taken.map(({ text }) => text), { timeout: WOKEN_WITHIN_MS }).toEqual([
      JSON.stringify({ fleetName: 'Aeolus fleet', bridgeUrl: `${address}/bridge?fleet=${fleetId}`, waitsAt: 'argo' }),
    ]);
  });
});
