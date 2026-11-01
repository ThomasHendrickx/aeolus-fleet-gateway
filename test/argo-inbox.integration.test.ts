import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { applyEmptyOwnRules, commission, letReadArgo, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// argo's inbox reaches the people allowed as argo only once argo lets the
// gateway's ship read it (argo's inbox, AI9): until then, the gateway's
// overview tells an account allowed as argo so, and where argo adds the
// rule. The fleet and the gateway are real; pagasae is a fake.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const ALLOWED_SIGN_IN = 'charlotte-allowed-as-argo';
const NO_LONGER_SIGN_IN = 'charlotte-no-longer-allowed';
const SEEN_WITHIN_MS = 15_000;
const POLL_MS = 200;

let fleet: FleetServer;
let pagasae: FakePagasae;
let app: GatewayApp;
let address: string;
let fleetId: string;
let cookie: string;
let gatewayShip: { shipId: ShipId; secret: string };

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  const who = await createRestFleetDoor(fleet.url).whoami(await register(fleet, charlotte));
  if (!who.isOk) {
    throw new Error('charlotte is not crewed');
  }
  fleetId = who.value.fleetId;
  await applyEmptyOwnRules(fleet, cookie);
  pagasae = await startFakePagasae();
  pagasae.sharedSignIn(ALLOWED_SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: charlotte.shipId, argo: true });
  pagasae.sharedSignIn(NO_LONGER_SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: charlotte.shipId, argo: false });
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({
    databaseUrl: await migratedDatabase(inject('postgresUrl')),
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: address,
    gatewaySecret: TEST_GATEWAY_SECRET,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
  });
  await app.server.listen({ host: '127.0.0.1', port });
  await app.restoreConnections();
  const connected = await connectGateway(address, { cookie, ...gatewayShip });
  expect(connected.status, await connected.clone().text()).toBe(200);
});

afterEach(async () => {
  await app.close();
  await pagasae.stop();
  await fleet.stop();
});

const noticeSchema = z.object({ result: z.object({ data: z.union([z.object({ kind: z.literal('none') }), z.object({ kind: z.literal('notLetRead'), gatewayShip: z.object({ shipId: z.string(), name: z.string() }) })]) }) });

/** The overview's notice of argo's read rule, as the pages read it for the shared sign-in. */
async function noticeFor(signIn: string) {
  const read = await fetch(`${address}/trpc/people.argoInboxNotice`, { headers: { cookie: `aeolus_account_session=${signIn}`, 'aeolus-fleet': fleetId } });
  return noticeSchema.parse(await read.json()).result.data;
}

/** The notice once it is the one expected, or the last one read when it did not come within the time a person waits. */
async function noticeOnceItIs(signIn: string, kind: 'none' | 'notLetRead') {
  const deadline = Date.now() + SEEN_WITHIN_MS;
  let notice = await noticeFor(signIn);
  while (notice.kind !== kind && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    notice = await noticeFor(signIn);
  }
  return notice;
}

describe("the overview's notice of argo's read rule, on a real fleet", () => {
  it('reads nothing with no rule and shows the notice to an account allowed as argo, naming the ship the rule lets read argo', async () => {
    await expect(noticeOnceItIs(ALLOWED_SIGN_IN, 'notLetRead')).resolves.toEqual({ kind: 'notLetRead', gatewayShip: { shipId: gatewayShip.shipId, name: 'gateway' } });
  });

  it('shows no notice once argo adds the read rule', async () => {
    await noticeOnceItIs(ALLOWED_SIGN_IN, 'notLetRead');

    await letReadArgo(fleet, { cookie, readerShipId: gatewayShip.shipId });

    await expect(noticeOnceItIs(ALLOWED_SIGN_IN, 'none')).resolves.toEqual({ kind: 'none' });
  });

  it('drops an account no longer allowed as argo at its next token: the notice is not shown to it any more', async () => {
    await noticeOnceItIs(ALLOWED_SIGN_IN, 'notLetRead');

    await noticeFor(NO_LONGER_SIGN_IN);

    await expect(noticeFor(ALLOWED_SIGN_IN)).resolves.toEqual({ kind: 'none' });
  });
});
