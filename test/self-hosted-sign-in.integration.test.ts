/** The first self-hosted person's Bridge journey uses the existing HTTP sign-in contract and real core storage. */
import { idSchema, receiveOutputSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createSeeInSlack } from '../src/core/slack/see-in-slack.js';
import { createSendSlackEvents } from '../src/core/slack/send-slack-events.js';
import { memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries } from './support/people-fakes.js';
import { aKeptSlackEvent, aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackEvents, memorySlackLinks, memorySlackPosts } from './support/slack-fakes.js';
import { createAccountSignInSeals } from '../src/adapters/crypto/account-sign-in-seals.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, setOwner } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, WAKE_INSTALLATION_TOKEN, type FakePagasae } from './support/fake-pagasae.js';
import { aFleetOfTheInstallation, aFreePort, startInstallationServer, type FleetServer } from './support/fleet-server.js';
import { OTHER_FLEET_ID } from './support/fleet-fakes.js';
import { connectGateway, mutate } from './support/gateway-api.js';
import { startLostAnswerFleet } from './support/lost-answer-fleet.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

const SHARED_SESSION = 'maya-shared-session';
const ACCOUNT_ID = 'maya-opaque-account';
const QUESTION_ID = '7b5b81e2-a4e1-47c2-9907-8e39d6f1d251';
const QUESTION = { id: QUESTION_ID, title: 'Release the research?', context: 'The report is ready.', options: [{ key: 1, label: 'Release' }, { key: 2, label: 'Wait' }], pick: { option: 1, why: 'The report is ready.' } };
const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const dataOf = <T extends z.ZodType>(schema: T) => z.object({ result: z.object({ data: schema }) });
const inboxSchema = dataOf(z.object({ waiting: z.number(), deliveries: z.array(z.object({ deliveryId: idSchema('delivery'), title: z.string() })), opened: z.array(z.object({ deliveryId: idSchema('delivery') })) }));
const basketSchema = dataOf(z.object({ entries: z.array(z.object({ questionId: z.string(), standing: z.object({ kind: z.string() }) })) }));

let gatewayNow: Date | undefined;
let service: FakePagasae;
let fleet: FleetServer;
let app: GatewayApp;
let prisma: PrismaClient;
let fleetId: FleetId;
let personShipId: ShipId;
let researcher: string;
let researcherShipId: ShipId;
let fleetCookie: string;
let address: string;
let databaseUrl: string;
let fleetBoundary: Awaited<ReturnType<typeof startLostAnswerFleet>>;

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...charlotteIn(service, fleetId), sub: ACCOUNT_ID, group: [], person_ship: personShipId, ...overrides };
}

async function startGateway(): Promise<void> {
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({ databaseUrl, fleetUrl: fleetBoundary.url, publicUrl: address, logger: false, clock: { now: () => gatewayNow ?? new Date() }, gatewaySecret: TEST_GATEWAY_SECRET, installationToken: WAKE_INSTALLATION_TOKEN, pagasae: { url: service.url, ...PAGASAE_CLIENT }, pagasaeApp: PAGASAE_APP_CLIENT });
  await app.server.listen({ host: '127.0.0.1', port });
  await app.restoreConnections();
}

beforeEach(async () => {
  gatewayNow = undefined;
  service = await startFakePagasae({ email: 'maya@example.test', firstName: 'Maya' });
  fleet = await startInstallationServer(inject('postgresUrl'), { installationToken: WAKE_INSTALLATION_TOKEN, accountTokenIssuer: service.url });
  fleetBoundary = await startLostAnswerFleet(fleet.url);
  const made = await aFleetOfTheInstallation(fleet, { installationToken: WAKE_INSTALLATION_TOKEN, name: 'workshop' });
  fleetId = made.fleetId;
  // Setup has already reconciled the service's stable mapping. Gateway must use this id, never guess a name.
  const person = await commission(fleet, { cookie: made.cookie, ship: { name: 'person-maya-opaque-', type: 'person', kind: 'person' } });
  personShipId = person.shipId;
  fleetCookie = made.cookie;
  const agent = await commission(fleet, { cookie: made.cookie, ship: { name: 'researcher', type: 'researcher', kind: 'agent' } });
  await setOwner(fleet, { cookie: made.cookie, shipId: agent.shipId, ownerShipId: personShipId });
  researcherShipId = agent.shipId;
  researcher = await register(fleet, agent);
  const gateway = await commission(fleet, { cookie: made.cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
  service.sharedSignIn(SHARED_SESSION, claims());
  service.listFor(SHARED_SESSION, [{ id: fleetId, name: 'workshop' }]);
  await startGateway();
  expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: WAKE_INSTALLATION_TOKEN, body: { requestId: 'serve-workshop', fleetId, enabled: true } })).status).toBe(200);
  const connected = await connectGateway(address, { cookie: made.cookie, ...gateway });
  expect(connected.status, await connected.clone().text()).toBe(200);
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await service.stop();
  await fleetBoundary.stop();
  await fleet.stop();
});

/** The browser carries only its shared session; Bridge's server forwards it to the gateway API. */
function pageCall(procedure: string, body?: unknown): Promise<Response> {
  const headers = { 'content-type': 'application/json', cookie: `aeolus_account_session=${SHARED_SESSION}`, 'aeolus-fleet': fleetId };
  return fetch(`${address}/trpc/${procedure}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
}

async function roundTrip() {
  const start = await fetch(`${address}/sign-in/start?return_to=${encodeURIComponent(`/bridge?fleet=${fleetId}`)}`, { redirect: 'manual' });
  const cookie = start.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  const authorize = new URL(start.headers.get('location') ?? '');
  const authorized = await fetch(authorize, { redirect: 'manual' });
  const callback = new URL(authorized.headers.get('location') ?? '');
  return { cookie, authorize, callback };
}

async function askMaya(): Promise<string> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${researcher}` }, body: JSON.stringify({ selector: { kind: 'ship', shipId: personShipId }, contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify(QUESTION), model: 'test-researcher', idempotencyKey: QUESTION_ID }) });
  expect(sent.status, await sent.clone().text()).toBe(200);
  return z.object({ messageId: idSchema('message') }).parse(await sent.json()).messageId;
}

async function openQuestion(): Promise<string> {
  const inbox = inboxSchema.parse(await (await pageCall('people.inbox')).json()).result.data;
  expect(inbox).toMatchObject({ waiting: 1, deliveries: [{ title: QUESTION.title }] });
  const deliveryId = z.string().parse(inbox.deliveries[0]?.deliveryId);
  expect((await pageCall('people.open', { deliveryId })).status).toBe(200);
  return deliveryId;
}

describe('self-hosted sign-in through the existing service contract', () => {
  it('binds state and PKCE to the browser, crews the mapped person on the server, and delivers her basket answer to her agent', async () => {
    const trip = await roundTrip();
    expect(trip.authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(trip.authorize.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(trip.authorize.searchParams.has('client_secret')).toBe(false);
    const back = await fetch(trip.callback, { redirect: 'manual', headers: { cookie: trip.cookie } });
    expect(back.headers.get('location')).toBe(`/bridge?fleet=${fleetId}`);
    const account = await pageCall('account.inView');
    expect(await account.json()).toEqual({ result: { data: { kind: 'signedIn', fleetId, accountId: ACCOUNT_ID, scopes: ['fleet:read'] } } });

    expect(await (await pageCall('account.apps')).json()).toMatchObject({ result: { data: { account: { id: ACCOUNT_ID, firstName: 'Maya' }, fleets: [{ id: fleetId, name: 'workshop' }] } } });
    const questionMessageId = await askMaya();
    const deliveryId = await openQuestion();
    const opened = inboxSchema.parse(await (await pageCall('people.inbox')).json()).result.data;
    expect(opened).toMatchObject({ waiting: 0, deliveries: [], opened: [{ deliveryId }] });
    const crew = await prisma.personCrew.findFirst({ where: { fleetId, shipId: personShipId } });
    const crewToken = z.string().min(1).parse(crew?.crewToken);
    const browserData = JSON.stringify(opened) + JSON.stringify(back.headers.getSetCookie());
    expect(browserData).not.toContain(crewToken);
    expect(browserData).not.toContain(PAGASAE_APP_CLIENT.clientSecret);
    expect((await pageCall('people.putInBasket', { deliveryId, option: 1, optionLabel: 'Release', note: 'Ready' })).status).toBe(200);
    expect((await pageCall('people.sendBasket', {})).status).toBe(200);
    await expect.poll(async () => basketSchema.parse(await (await pageCall('people.basket')).json()).result.data.entries[0]?.standing.kind).toBe('sent');
    const received = await fetch(`${fleet.url}/api/v1/ship/receive`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${researcher}` }, body: '{}' });
    const answers = receiveOutputSchema.parse(await received.json()).deliveries;
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ senderShipId: personShipId, inReplyTo: questionMessageId, contentType: 'application/vnd.aeolus.answer+json', payload: JSON.stringify({ questionId: QUESTION_ID, option: 1, note: 'Ready' }) });
    const acknowledged = await fetch(`${fleet.url}/api/v1/ship/ack`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${researcher}` }, body: JSON.stringify({ deliveryId: answers[0]?.deliveryId }) });
    expect(acknowledged.status).toBe(200);
  });

  it('refuses another browser before redemption, lets the initiating browser finish, and refuses code replay', async () => {
    const trip = await roundTrip();
    const other = await fetch(trip.callback, { redirect: 'manual', headers: { cookie: 'aeolus_account_sign_in=another-browser' } });
    expect(other.headers.get('location')).toBe('/sign-in/failed?reason=otherBrowser');
    const completed = await fetch(trip.callback, { redirect: 'manual', headers: { cookie: trip.cookie } });
    expect(completed.headers.get('location')).toBe(`/bridge?fleet=${fleetId}`);
    const replay = await fetch(trip.callback, { redirect: 'manual', headers: { cookie: trip.cookie } });
    expect(replay.headers.get('location')).toBe('/sign-in/failed?reason=pagasaeRefused');
  });

  it.each(['unknown', 'expired'])('refuses %s state before consuming the code', async (stateKind) => {
    const trip = await roundTrip();
    const bad = new URL(trip.callback);
    const seals = createAccountSignInSeals(TEST_GATEWAY_SECRET);
    bad.searchParams.set('state', stateKind === 'unknown' ? 'unknown' : seals.seal({ verifier: 'expired-verifier', browserSecret: 'expired-browser', returnTo: '/bridge', expiresAt: new Date(0) }));
    const refused = await fetch(bad, { redirect: 'manual', headers: { cookie: trip.cookie } });
    expect(refused.headers.get('location')).toBe('/sign-in/failed?reason=unknownSignIn');
    const completed = await fetch(trip.callback, { redirect: 'manual', headers: { cookie: trip.cookie } });
    expect(completed.headers.get('location')).toBe(`/bridge?fleet=${fleetId}`);
  });

  it('refuses a code whose verifier belongs to another round trip', async () => {
    const first = await roundTrip();
    const second = await roundTrip();
    second.callback.searchParams.set('code', first.callback.searchParams.get('code') ?? '');
    const refused = await fetch(second.callback, { redirect: 'manual', headers: { cookie: second.cookie } });
    expect(refused.headers.get('location')).toBe('/sign-in/failed?reason=pagasaeRefused');
  });

  it('distinguishes a signed-out browser, a person with no fleet rights, and a service outage', async () => {
    const signedOut = await fetch(`${address}/trpc/account.inView`, { headers: { 'aeolus-fleet': fleetId } });
    expect(signedOut.status).toBe(401);
    service.sharedSignIn('without-workshop-rights', claims({ aud: OTHER_FLEET_ID }));
    const noRights = await fetch(`${address}/trpc/account.inView`, { headers: { 'aeolus-fleet': fleetId, cookie: 'aeolus_account_session=without-workshop-rights' } });
    expect(noRights.status).toBe(200);
    expect(await noRights.json()).toMatchObject({ result: { data: { kind: 'elsewhere' } } });
    service.setAvailable(false);
    const unavailable = await pageCall('account.inView');
    expect(unavailable.status, await unavailable.clone().text()).toBe(503);
  });

  it('does not guess a person ship when the service mapping is absent and accepts that same mapping once reconciled', async () => {
    service.sharedSignIn(SHARED_SESSION, claims({ person_ship: undefined }));
    const refused = await pageCall('people.inbox');
    expect(refused.status).toBe(403);
    expect(await prisma.personCrew.count({ where: { fleetId } })).toBe(0);
    service.sharedSignIn(SHARED_SESSION, claims());
    expect((await pageCall('people.inbox')).status).toBe(200);
    expect(await prisma.personCrew.count({ where: { fleetId, shipId: personShipId } })).toBe(1);
  });

  async function disableAccount() {
    const revoked = await fetch(`${service.url}/oauth/revoke`, { method: 'POST', body: new URLSearchParams({ token: SHARED_SESSION, client_id: PAGASAE_APP_CLIENT.clientId, client_secret: PAGASAE_APP_CLIENT.clientSecret }) });
    expect(revoked.status).toBe(200);
    return mutate(address, { procedure: 'installation.accountDisabled', installationToken: WAKE_INSTALLATION_TOKEN, body: { fleetId, accountId: ACCOUNT_ID } });
  }

  it('invalidates browser authorisation immediately on authenticated account disabling despite a retained person crew', async () => {
    expect((await pageCall('people.inbox')).status).toBe(200);
    const disabled = await disableAccount();
    expect(disabled.status).toBe(200);
    expect(await prisma.personCrew.count({ where: { fleetId, shipId: personShipId } })).toBe(1);
    expect((await pageCall('people.inbox')).status).toBe(401);
  });

  it('refuses an unauthenticated account-disabled notification', async () => {
    const response = await mutate(address, { procedure: 'installation.accountDisabled', body: { fleetId, accountId: ACCOUNT_ID } });
    expect(response.status).toBe(401);
  });

  it('acknowledges a retry of authenticated account disabling', async () => {
    await pageCall('people.inbox');
    expect((await disableAccount()).status).toBe(200);
    const retried = await mutate(address, { procedure: 'installation.accountDisabled', installationToken: WAKE_INSTALLATION_TOKEN, body: { fleetId, accountId: ACCOUNT_ID } });
    expect(retried.status).toBe(200);
  });

  it('refuses basket sending after account disabling despite a retained person crew', async () => {
    await pageCall('people.inbox');
    await disableAccount();
    expect((await pageCall('people.sendBasket', {})).status).toBe(401);
  });

  it('preserves opened work after account disabling and recovery', async () => {
    await askMaya();
    const deliveryId = await openQuestion();
    await disableAccount();
    service.sharedSignIn(SHARED_SESSION, claims());
    const restored = inboxSchema.parse(await (await pageCall('people.inbox')).json()).result.data;
    expect(restored).toMatchObject({ waiting: 0, opened: [{ deliveryId }] });
  });

  it('preserves a draft basket answer after account disabling and recovery', async () => {
    await askMaya();
    const deliveryId = await openQuestion();
    expect((await pageCall('people.putInBasket', { deliveryId, option: 2, optionLabel: 'Wait', note: 'Keep this draft' })).status).toBe(200);
    await disableAccount();
    service.sharedSignIn(SHARED_SESSION, claims());
    expect(basketSchema.parse(await (await pageCall('people.basket')).json()).result.data.entries).toMatchObject([{ questionId: QUESTION_ID, standing: { kind: 'waiting' } }]);
  });

  async function releasedSlack() {
    const messageId = idSchema('message').parse(await askMaya());
    const deliveryId = idSchema('delivery').parse(await openQuestion());
    const crew = await prisma.personCrew.findFirstOrThrow({ where: { fleetId, shipId: personShipId } });
    const released = await fetch(`${fleet.url}/trpc/fleet.release`, { method: 'POST', headers: { 'content-type': 'application/json', origin: fleet.url, cookie: fleetCookie }, body: JSON.stringify({ shipId: personShipId }) });
    expect(released.status, await released.clone().text()).toBe(200);
    const now = new Date();
    const apps = memorySlackApps();
    const links = memorySlackLinks();
    const posts = memorySlackPosts();
    const slack = fakeSlackMessages();
    await apps.save(aSlackApp({ fleetId, appId: 'A01', shipId: researcherShipId, bot: { token: 'slack-bot', userId: 'U01' } }));
    await links.add(aSlackLink({ fleetId, accountId: ACCOUNT_ID, personShipId }));
    await posts.save({ fleetId, personShipId, messageId, deliveryId, senderShipId: researcherShipId, appId: 'A01', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null });
    const crews = { find: () => Promise.resolve({ ...crew, fleetId, shipId: personShipId }) };
    return { apps, links, posts, slack, crews, messageId, deliveryId, clock: { now: () => now }, door: createRestFleetDoor(fleet.url) };
  }

  it('stops Slack button access after person-crew release without a gateway disable notification', async () => {
    const setup = await releasedSlack();
    const outcomes = memoryItemOutcomes();
    const see = createSeeInSlack({ ...setup, door: setup.door.person, outcomes, opened: memoryOpenedDeliveries(), changes: memoryInboxChanges(), slack: setup.slack.messages, signatures: { isSigned: () => true } });
    await see({ appId: 'A01', teamId: 'T0ACME', userId: 'U0MATHILDE', channel: 'D0MATHILDE', messageTs: '1730020000.000001', messageId: setup.messageId, body: 'press', timestamp: String(setup.clock.now().getTime() / 1000), signature: 'signed' });
    expect(outcomes.held).toEqual([]);
    expect((await setup.links.ofAccount(fleetId, ACCOUNT_ID))?.stoppedAt).toEqual(setup.clock.now());
  });

  it('ends queued Slack message retries after person-crew release without a gateway disable notification', async () => {
    const setup = await releasedSlack();
    const events = memorySlackEvents();
    await events.keep(aKeptSlackEvent({ fleetId, appId: 'A01', personShipId, shipId: researcherShipId, receivedAt: setup.clock.now() }));
    const round = createSendSlackEvents({ ...setup, events, sender: setup.door, door: setup.door.person, slack: setup.slack.messages });
    await round();
    expect((await setup.links.ofAccount(fleetId, ACCOUNT_ID))?.stoppedAt).toEqual(setup.clock.now());
    expect(events.held[0]?.takenAt).toEqual(setup.clock.now());
    const received = await fetch(`${fleet.url}/api/v1/ship/receive`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${researcher}` }, body: '{}' });
    expect(receiveOutputSchema.parse(await received.json()).deliveries).toEqual([]);
  });

  it('refuses human access after token expiry and allowance without notification or renewal despite a retained person crew', async () => {
    expect((await pageCall('people.inbox')).status).toBe(200);
    service.setAvailable(false);
    gatewayNow = new Date(Date.now() + 630_001);

    expect((await pageCall('people.inbox')).status).toBe(401);
    expect((await pageCall('people.sendBasket', {})).status).toBe(401);
    expect(await prisma.personCrew.count({ where: { fleetId, shipId: personShipId } })).toBe(1);
  });

  it('keeps an unconfirmed answer visibly unsent and retries the same send key after restarting, storing only one answer in core', async () => {
    await askMaya();
    const deliveryId = await openQuestion();
    expect((await pageCall('people.putInBasket', { deliveryId, option: 1, optionLabel: 'Release', note: '' })).status).toBe(200);
    fleetBoundary.loseConfirmations(true);
    expect((await pageCall('people.sendBasket', {})).status).toBe(200);
    await expect.poll(async () => {
      const basket = await (await pageCall('people.basket')).json();
      return dataOf(z.object({ entries: z.array(z.object({ standing: z.object({ kind: z.string(), isUnanswered: z.boolean().optional() }) })) })).parse(basket).result.data.entries[0]?.standing;
    }).toEqual({ kind: 'sending', isUnanswered: true });
    const originalKey = z.string().min(1).parse(fleetBoundary.keys[0]);
    await app.close();
    fleetBoundary.loseConfirmations(false);
    await startGateway();
    await expect.poll(async () => basketSchema.parse(await (await pageCall('people.basket')).json()).result.data.entries[0]?.standing.kind).toBe('sent');
    expect(fleetBoundary.keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(fleetBoundary.keys)).toEqual(new Set([originalKey]));
    const received = await fetch(`${fleet.url}/api/v1/ship/receive`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${researcher}` }, body: '{}' });
    const answers = receiveOutputSchema.parse(await received.json()).deliveries;
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ senderShipId: personShipId, payload: JSON.stringify({ questionId: QUESTION_ID, option: 1 }) });
  });

  it('keeps a pending question through a sign-in outage and an opened question through a gateway restart', async () => {
    await askMaya();
    service.setAvailable(false);
    expect((await pageCall('account.inView')).status).toBe(503);
    service.setAvailable(true);
    const deliveryId = await openQuestion();
    await app.close();
    await startGateway();
    const inbox = inboxSchema.parse(await (await pageCall('people.inbox')).json()).result.data;
    expect(inbox).toMatchObject({ waiting: 0, deliveries: [], opened: [{ deliveryId }] });
    expect((await pageCall('people.putInBasket', { deliveryId, option: 2, optionLabel: 'Wait', note: '' })).status).toBe(200);
  });
});
