import { beforeEach, describe, expect, it } from 'vitest';

import { anArgoEntry, DONE_AT, fakeArgoInboxFleet, MATHILDE_ACCOUNT_ID, memoryArgoAccounts } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createFollowArgoInbox } from './follow-argo-inbox.js';
import { createReadArgoSection } from './read-argo-section.js';

// Bridge's argo section (argo's inbox, AI2 to AI4): every message open at
// argo, questions included, plugin senders unfolded, with a count of its
// own, shown only to an account allowed as argo. Each links to it in the
// console, signed in as argo; one done at argo leaves it for everyone.

const THOMAS = { fleetId: FLEET_ID, accountId: 'acc-thomas' };
const MATHILDE_SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank9mat';
const QUESTION = 'application/vnd.aeolus.question+json';
const QUESTION_ID = 'b3f1c6a2-0d7e-4c55-9a51-6f0e4e2d9a11';
const BUILDER_MEMORY = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9bme', name: 'builder-memory' };
const signal = new AbortController().signal;

let accounts: ReturnType<typeof memoryArgoAccounts>;
let fleet: ReturnType<typeof fakeArgoInboxFleet>;
let follow: ReturnType<typeof createFollowArgoInbox>;
let now: Date;

beforeEach(async () => {
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-11-01T08:00:00.000Z') });
  accounts = memoryArgoAccounts();
  await accounts.keep(FLEET_ID, { accountId: THOMAS.accountId, personShipId: PERSON_SHIP_ID });
  await accounts.keep(FLEET_ID, { accountId: MATHILDE_ACCOUNT_ID, personShipId: MATHILDE_SHIP_ID });
  fleet = fakeArgoInboxFleet();
  follow = createFollowArgoInbox({ connections, door: fleet.door });
  now = new Date('2026-11-01T09:30:00.000Z');
});

function readSection(caller = THOMAS) {
  return createReadArgoSection({
    accounts,
    inboxOf: follow.inboxOf,
    shipNames: { nameOf: (_fleetId, shipId) => Promise.resolve(shipId === MATHILDE_SHIP_ID ? 'Mathilde' : undefined) },
    clock: () => now,
    consoleUrlOf: (deliveryId) => `https://fleet.example/inbox?message=${deliveryId}`,
  })(caller);
}

function aQuestion(number: number, overrides: Parameters<typeof anArgoEntry>[1] = {}) {
  return anArgoEntry(number, { sender: BUILDER_MEMORY, contentType: QUESTION, headline: 'Which repository holds the memory plugin?', askedQuestionId: QUESTION_ID, ...overrides });
}

describe("Bridge's argo section", () => {
  it('shows every message open at argo with its own count to an account allowed as argo, newest first, each linked to it in the console', async () => {
    fleet.send(anArgoEntry(1, { payload: 'thomas-mac is low on disk: 4% free' }));
    fleet.send(aQuestion(2));
    await follow.round(signal);

    await expect(readSection()).resolves.toEqual({
      count: 2,
      items: [
        { deliveryId: aQuestion(2).deliveryId, title: 'Which repository holds the memory plugin?', from: 'builder-memory', sentAt: '2026-11-01T09:02:00.000Z', kind: 'question', look: 'decide', isNew: true, stale: null, consoleUrl: `https://fleet.example/inbox?message=${aQuestion(2).deliveryId}` },
        { deliveryId: anArgoEntry(1).deliveryId, title: 'thomas-mac is low on disk: 4% free', from: 'trierarch', sentAt: '2026-11-01T09:01:00.000Z', kind: 'report', look: 'alert', isNew: true, stale: null, consoleUrl: `https://fleet.example/inbox?message=${anArgoEntry(1).deliveryId}` },
      ],
      done: null,
    });
  });

  it('shows no section to an account not allowed as argo', async () => {
    fleet.send(anArgoEntry(1));
    await follow.round(signal);

    await expect(readSection({ fleetId: FLEET_ID, accountId: 'acc-charlotte' })).resolves.toBeNull();
  });

  it("shows no section while argo has not let the gateway's ship read its inbox", async () => {
    fleet.state.isReadRuleOn = false;
    await follow.round(signal);

    await expect(readSection()).resolves.toBeNull();
  });

  it('shows a notice in its own look, and a message as new only within the hour after it was sent', async () => {
    fleet.send(anArgoEntry(1, { contentType: 'application/vnd.aeolus.notice+json' }));
    fleet.send(anArgoEntry(2));
    await follow.round(signal);
    now = new Date('2026-11-01T10:01:00.000Z');

    const section = await readSection();

    expect(section?.items.map(({ look, isNew }) => ({ look, isNew }))).toEqual([
      { look: 'alert', isNew: true },
      { look: 'notice', isNew: false },
    ]);
  });

  it('takes a stale question out of the count, and lists the withdrawal itself nowhere', async () => {
    fleet.send(aQuestion(1));
    fleet.send(anArgoEntry(2, { sender: BUILDER_MEMORY, contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: JSON.stringify({ questionId: QUESTION_ID }), withdrawnQuestionId: QUESTION_ID }));
    fleet.send(anArgoEntry(3));
    await follow.round(signal);

    const section = await readSection();

    expect({ count: section?.count, items: section?.items.map(({ deliveryId, stale }) => ({ deliveryId, stale: stale?.kind ?? null })) }).toEqual({
      count: 1,
      items: [
        { deliveryId: anArgoEntry(3).deliveryId, stale: null },
        { deliveryId: aQuestion(1).deliveryId, stale: 'withdrawn' },
      ],
    });
  });

  it('leaves the section and its count once done at argo, saying who did it, in the console, and when', async () => {
    fleet.send(anArgoEntry(1, { payload: 'thomas-mac is low on disk: 4% free' }));
    fleet.send(aQuestion(2));
    await follow.round(signal);
    now = new Date('2026-11-01T20:20:00.000Z');

    fleet.markDone(anArgoEntry(1).messageId);
    await follow.round(signal);

    const section = await readSection();
    expect({ count: section?.count, items: section?.items.map(({ deliveryId }) => deliveryId), done: section?.done }).toEqual({
      count: 1,
      items: [aQuestion(2).deliveryId],
      done: { title: 'thomas-mac is low on disk: 4% free', at: DONE_AT.toISOString(), by: 'Mathilde', isInConsole: true },
    });
  });

  it('says a message was done at argo without naming anyone when no account allowed as argo did it, and no more after an hour', async () => {
    fleet.send(anArgoEntry(1));
    await follow.round(signal);
    fleet.markDone(anArgoEntry(1).messageId, { signedInAccountId: null });
    await follow.round(signal);
    now = new Date('2026-11-01T20:20:00.000Z');
    const within = (await readSection())?.done;

    now = new Date('2026-11-01T21:15:00.000Z');

    expect({ within, after: (await readSection())?.done }).toEqual({ within: { title: 'Report 001 to argo', at: DONE_AT.toISOString(), by: null, isInConsole: false }, after: null });
  });
});
