import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaRoutes } from '../src/adapters/prisma/routes.js';
import { createPrismaSlackLinks } from '../src/adapters/prisma/slack-links.js';
import { createPrismaSlackApps } from '../src/adapters/prisma/slack-stores.js';
import { applyEmptyOwnRules, argoShipId, commission, letReadArgo, markDoneAsArgo, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { startFakeSlack, type FakeSlack } from './support/fake-slack.js';
import { connectGateway } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { send } from './support/ship.js';
import { aSlackApp, aSlackLink } from './support/slack-fakes.js';

// argo's inbox reaches the people allowed as argo only once argo lets the
// gateway's ship read it (argo's inbox, AI9): until then, the gateway's
// overview tells an account allowed as argo so, and where argo adds the
// rule. Once it may, what waits at argo is posted in Slack to each person
// allowed as argo who turned Slack on, and edited once done at argo (AI4).
// The fleet and the gateway are real; pagasae and Slack are fakes.

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
let charlotteShipId: ShipId;
let databaseUrl: string;
let slack: FakeSlack;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  charlotteShipId = charlotte.shipId;
  const who = await createRestFleetDoor(fleet.url).whoami(await register(fleet, charlotte));
  if (!who.isOk) {
    throw new Error('charlotte is not crewed');
  }
  fleetId = who.value.fleetId;
  await applyEmptyOwnRules(fleet, cookie);
  pagasae = await startFakePagasae();
  pagasae.sharedSignIn(ALLOWED_SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: charlotte.shipId, argo: true });
  pagasae.sharedSignIn(NO_LONGER_SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: charlotte.shipId, argo: false });
  slack = await startFakeSlack();
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({
    databaseUrl,
    slackApiUrl: slack.apiUrl,
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
  await slack.stop();
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

/** What a test waits for, once it holds, or as it is when it did not within the time a person waits. */
async function onceItHolds<T>(read: () => T, holds: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + SEEN_WITHIN_MS;
  let value = read();
  while (!holds(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    value = read();
  }
  return value;
}

describe("Slack's post for what waits at argo, on a real fleet", () => {
  it('posts a trierarch report to a person allowed as argo with Slack on, and edits it once argo marked it done in the console', async () => {
    const prisma = createPrismaClient(databaseUrl);
    await createPrismaSlackApps(prisma).save(aSlackApp({ fleetId, appId: 'A01', name: 'Aeolus fleet', bot: { token: 'xoxb-A01', userId: 'U01' } }));
    await createPrismaSlackLinks(prisma).add(aSlackLink({ fleetId, accountId: 'acc-charlotte', personShipId: charlotteShipId, slackUserId: 'U0CHARLOTTE' }));
    await createPrismaRoutes(prisma).save({ fleetId, shipId: charlotteShipId, job: 'everything-else', place: 'slack', isOn: true, changedAt: new Date('2026-10-19T00:00:00.000Z') });
    await prisma.$disconnect();
    await noticeOnceItIs(ALLOWED_SIGN_IN, 'notLetRead');
    await letReadArgo(fleet, { cookie, readerShipId: gatewayShip.shipId });
    const trierarch = await register(fleet, await commission(fleet, { cookie, ship: { name: 'thomas-mac', type: 'trierarch', scopes: ['messages:send'] } }));

    await send(fleet, { crewToken: trierarch, to: await argoShipId(fleet, cookie), contentType: 'text/plain', payload: 'thomas-mac is low on disk: 4% free' });
    const posted = await onceItHolds(() => slack.posted, (each) => each.length > 0);
    const deliveryId = /message=(dlv_[a-z0-9]+)/.exec(posted[0]?.form.attachments ?? '')?.[1] ?? '';
    await markDoneAsArgo(fleet, { cookie, deliveryId });
    const updated = await onceItHolds(() => slack.updated, (each) => each.length > 0);

    expect({
      posted: posted.map(({ botToken, form }) => ({ botToken, channel: form.channel, isWaitingAtArgo: form.attachments?.includes('Waits at argo') })),
      updated: updated.map(({ form }) => ({ channel: form.channel, isDoneAtArgo: form.attachments?.includes('Done at argo') })),
    }).toEqual({ posted: [{ botToken: 'xoxb-A01', channel: 'U0CHARLOTTE', isWaitingAtArgo: true }], updated: [{ channel: 'U0CHARLOTTE', isDoneAtArgo: true }] });
  });
});
