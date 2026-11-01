import { idSchema, receiveOutputSchema, sendOutputSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaItemOutcomes } from '../src/adapters/prisma/item-outcomes.js';
import { createPrismaOpenedDeliveries } from '../src/adapters/prisma/opened-deliveries.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import { createDoneDelivery } from '../src/core/people/done-delivery.js';
import { createFinishOwnStep } from '../src/core/people/finish-own-step.js';
import { createOpenDelivery } from '../src/core/people/open-delivery.js';
import type { PersonCaller } from '../src/core/people/person-crew.js';
import { createPrismaSlackLinkSteps } from '../src/adapters/prisma/slack-link-steps.js';
import type { SharedAccountToken } from '../src/core/account-sign-in/ports.js';
import { createAskToLinkSlack } from '../src/core/slack/ask-to-link-slack.js';
import { createCompleteLink } from '../src/core/slack/complete-link.js';
import { createReadSlackLink } from '../src/core/slack/read-slack-link.js';
import { ok } from '../src/core/shared/result.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { memoryConnectionStore } from './support/fleet-fakes.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { aSlackApp, aSlackWorkspace, fakeShipNames, fakeSlackSignIn, memorySlackApps, memorySlackLinks, memorySlackWorkspaces, plainLinkStates } from './support/slack-fakes.js';

// Do what only a human can, against a real core and the gateway's own
// Postgres (Bridge, CC14, CC23): builder-plugin asks Charlotte for two
// steps; she marks one done and the other cannot, each with a note, and
// builder-plugin receives each outcome at once, in reply to its step. The
// gateway's own step, asking her to sign in to an outside server, is done
// once her sign-in completes, with no press; so is its step asking her to
// link Slack, sent when she opens Bridge's settings, once her link
// completes.

const STEP = 'application/vnd.aeolus.step+json';
const STEP_OUTCOME = 'application/vnd.aeolus.step-outcome+json';
const AT = new Date('2026-10-31T21:05:00.000Z');

let prisma: PrismaClient;
let fleet: FleetServer;
let fleetId: FleetId;
let charlotte: { shipId: ShipId; crewToken: string };
let builder: { shipId: ShipId; crewToken: string };
let gateway: { shipId: ShipId; crewToken: string };

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  const aShip = async (ship: { name: string; type: string; kind: 'person' | 'app' }) => {
    const commissioned = await commission(fleet, { cookie, ship });
    return { shipId: commissioned.shipId, crewToken: await register(fleet, commissioned) };
  };
  charlotte = await aShip({ name: 'charlotte', type: 'person', kind: 'person' });
  builder = await aShip({ name: 'builder-plugin', type: 'builder', kind: 'app' });
  gateway = await aShip({ name: 'gateway', type: 'gateway', kind: 'app' });
  const who = await createRestFleetDoor(fleet.url).whoami(charlotte.crewToken);
  if (!who.isOk) {
    throw new Error(`charlotte is not crewed: ${who.error.message}`);
  }
  fleetId = who.value.fleetId;
  // Each test runs its own core: what an earlier one kept is not this fleet's.
  await prisma.personCrew.deleteMany({});
  await prisma.openedDelivery.deleteMany({});
  await prisma.slackLinkStep.deleteMany({});
  await createPrismaPersonCrews(prisma).save({ fleetId, shipId: charlotte.shipId, crewToken: charlotte.crewToken, crewedAt: AT });
});

afterEach(async () => {
  await fleet.stop();
});

/** Charlotte's sign-in in this run's fleet: the gateway crews her person ship as it. */
const charlotteSignedIn = (): PersonCaller => ({ fleetId, grantId: 'grant-charlotte' });

function people() {
  const door = createRestFleetDoor(fleet.url).person;
  const deps = {
    crewPersonShip: () => Promise.resolve(ok({ shipId: charlotte.shipId, crewToken: charlotte.crewToken })),
    crews: createPrismaPersonCrews(prisma),
    door,
    opened: createPrismaOpenedDeliveries(prisma),
    changes: { tell: () => Promise.resolve() },
    outcomes: createPrismaItemOutcomes(prisma),
    clock: { now: () => AT },
  };
  return { open: createOpenDelivery(deps), done: createDoneDelivery(deps), door };
}

async function sendStep(asker: { crewToken: string }, step: { id: string; title: string }): Promise<MessageId> {
  const response = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${asker.crewToken}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: STEP, payload: JSON.stringify({ ...step, why: 'The plugin needs it.' }), idempotencyKey: step.id }),
  });
  expect(response.status).toBe(200);
  return sendOutputSchema.parse(await response.json()).messageId;
}

/** What waits for a ship, as its crew receives it. */
async function received(ship: { crewToken: string }) {
  const response = await fetch(`${fleet.url}/api/v1/ship/receive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ship.crewToken}` },
    body: JSON.stringify({ max: 10 }),
  });
  return receiveOutputSchema.parse(await response.json()).deliveries.map(({ senderName, contentType, payload, inReplyTo }) => ({ senderName, contentType, payload, inReplyTo }));
}

/** Charlotte's deliveries waiting now, taken as the gateway lists them. */
async function waitingSteps() {
  const taken = await people().door.pushReceive(charlotte.crewToken, { max: 10 });
  return taken.isOk ? taken.value : [];
}

describe('a step done and one Cannot, each with a note, reach the asker as step outcomes', () => {
  it('sends builder-plugin each outcome with its note, in reply to its step, and both steps are handled', async () => {
    const repository = await sendStep(builder, { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create the GitHub repository aeolus-fleet-memory-plugin' });
    const secret = await sendStep(builder, { id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', title: 'Add the npm token to the repository secrets' });
    const steps = await waitingSteps();
    const { open, done } = people();
    for (const { deliveryId } of steps) {
      await expect(open({ caller: charlotteSignedIn(), deliveryId, place: 'bridge' })).resolves.toMatchObject({ isOk: true });
    }
    const [first, second] = steps;
    if (first === undefined || second === undefined) {
      throw new Error('charlotte received fewer than two steps');
    }

    await expect(done({ caller: charlotteSignedIn(), place: 'bridge', deliveryId: first.deliveryId, outcome: 'done', note: 'Created; it is private for now' })).resolves.toMatchObject({ isOk: true });
    await expect(done({ caller: charlotteSignedIn(), place: 'chat', deliveryId: second.deliveryId, outcome: 'cannot', note: 'I hold no npm token' })).resolves.toMatchObject({ isOk: true });

    await expect(received(builder)).resolves.toEqual(
      expect.arrayContaining([
        { senderName: 'charlotte', contentType: STEP_OUTCOME, payload: JSON.stringify({ stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', outcome: 'done', note: 'Created; it is private for now' }), inReplyTo: repository },
        { senderName: 'charlotte', contentType: STEP_OUTCOME, payload: JSON.stringify({ stepId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', outcome: 'cannot', note: 'I hold no npm token' }), inReplyTo: secret },
      ]),
    );
    await expect(createPrismaItemOutcomes(prisma).findMany(fleetId, { shipId: charlotte.shipId, deliveryIds: [first.deliveryId, second.deliveryId] })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ deliveryId: first.deliveryId, kind: 'done' }), expect.objectContaining({ deliveryId: second.deliveryId, kind: 'cannot' })]),
    );
  });
});

describe("the gateway's own sign-in step is done with no press", () => {
  it('reports the step handled once the sign-in completes, kept done by the gateway, and sends no outcome', async () => {
    const connections = memoryConnectionStore();
    await connections.save({ fleetId, shipId: gateway.shipId, name: 'gateway', crewToken: gateway.crewToken, crewedAt: AT });
    const stepMessageId = await sendStep(gateway, { id: '8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e', title: 'Sign in to attio' });
    const [step] = await waitingSteps();
    if (step === undefined) {
      throw new Error('charlotte received no step');
    }
    const door = createRestFleetDoor(fleet.url);
    const finish = createFinishOwnStep({ connections, sent: door, crews: createPrismaPersonCrews(prisma), door: door.person, opened: createPrismaOpenedDeliveries(prisma), outcomes: createPrismaItemOutcomes(prisma), changes: { tell: () => Promise.resolve() }, clock: { now: () => AT } });

    await finish({ fleetId, personShipId: charlotte.shipId, stepMessageId: step.messageId });

    const standing = await door.sentMessage(gateway.crewToken, step.messageId);
    expect({ sameMessage: step.messageId === stepMessageId, state: standing.isOk ? standing.value.state : standing }).toEqual({ sameMessage: true, state: 'handled' });
    await expect(createPrismaItemOutcomes(prisma).findMany(fleetId, { shipId: charlotte.shipId, deliveryIds: [step.deliveryId] })).resolves.toMatchObject([{ place: 'gateway', kind: 'done' }]);
    await expect(door.person.inbox(gateway.crewToken)).resolves.toEqual({ isOk: true, value: { waiting: 0 } });
  });
});

describe("the gateway's own Link Slack step is done with no press (BG7)", () => {
  it("is sent when she opens Bridge's settings unlinked, and reported handled once her link completes, kept done by the gateway", async () => {
    const connections = memoryConnectionStore();
    await connections.save({ fleetId, shipId: gateway.shipId, name: 'gateway', crewToken: gateway.crewToken, crewedAt: AT });
    const door = createRestFleetDoor(fleet.url);
    const workspaces = memorySlackWorkspaces();
    const apps = memorySlackApps();
    const links = memorySlackLinks();
    const steps = createPrismaSlackLinkSteps(prisma);
    await workspaces.save(aSlackWorkspace({ fleetId, teamName: 'Acme' }));
    await apps.save(aSlackApp({ fleetId, bot: { token: 'xoxb-A01', userId: 'U0A01' } }));
    const slack = fakeSlackSignIn();
    slack.state.codes.set('code-charlotte', { teamId: 'T0ACME', userId: 'U0CHARLOTTE', name: 'charlotte' });
    const states = plainLinkStates();
    const finishStep = createFinishOwnStep({ connections, sent: door, crews: createPrismaPersonCrews(prisma), door: door.person, opened: createPrismaOpenedDeliveries(prisma), outcomes: createPrismaItemOutcomes(prisma), changes: { tell: () => Promise.resolve() }, clock: { now: () => AT } });
    const readSlackLink = createReadSlackLink({ workspaces, apps, links, askToLink: createAskToLinkSlack({ steps, connections, sender: door, newStepId: () => '9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f', linkUrlOf: (id) => `https://gateway.acme.test/slack/link?fleet=${id}` }) });
    const completeLink = createCompleteLink({
      workspaces,
      apps,
      links,
      signIn: slack.signIn,
      states,
      accountOf: () => Promise.resolve(ok<SharedAccountToken>({ accountToken: 'token-charlotte', endsAt: new Date('2026-10-31T22:00:00.000Z'), accountId: 'acc-charlotte', personShipId: charlotte.shipId, scopes: [], isArgoAllowed: false })),
      shipNames: fakeShipNames(),
      clock: { now: () => AT },
      linkRedirectUrl: 'https://gateway.acme.test/gw/slack/link',
      steps,
      finishStep,
    });

    await readSlackLink({ actor: { fleetId, kind: 'account', accountId: 'acc-charlotte', personShipId: charlotte.shipId, accountToken: 'token-charlotte', scopes: [] } });
    const stepMessageId = (await prisma.slackLinkStep.findFirst({ where: { fleetId, personShipId: charlotte.shipId } }))?.stepMessageId;
    if (stepMessageId == null) {
      throw new Error('the gateway kept no Link Slack step');
    }
    const completed = await completeLink({ code: 'code-charlotte', state: states.seal({ fleetId, accountId: 'acc-charlotte', personShipId: charlotte.shipId, expiresAt: new Date('2026-10-31T21:15:00.000Z') }), signIn: 'sign-in-charlotte' });

    const standing = await door.sentMessage(gateway.crewToken, idSchema('message').parse(stepMessageId));
    expect({ isLinked: completed.isOk, state: standing.isOk ? standing.value.state : standing }).toEqual({ isLinked: true, state: 'handled' });
    await expect(createPrismaItemOutcomes(prisma).findMany(fleetId, { shipId: charlotte.shipId, deliveryIds: standing.isOk ? [standing.value.deliveryId] : [] })).resolves.toMatchObject([{ place: 'gateway', kind: 'done' }]);
    await expect(door.person.inbox(gateway.crewToken)).resolves.toEqual({ isOk: true, value: { waiting: 0 } });
  });
});
