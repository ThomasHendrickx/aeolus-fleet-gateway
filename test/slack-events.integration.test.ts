import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaSlackEvents } from '../src/adapters/prisma/slack-events.js';
import { migratedDatabase } from './support/database.js';
import { aKeptSlackEvent } from './support/slack-fakes.js';

// The gateway keeps a linked person's Slack message by Slack's event id
// until core takes it (gateway scopes 9.4 step 3): a retry keeps nothing
// more, two gateway instances never send one event at once, and a taken
// event keeps only its id.

const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const AT = new Date('2026-10-27T09:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

beforeEach(async () => {
  await prisma.slackEvent.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("kept Slack events in the gateway's database", () => {
  it('keeps an event once by its fleet and event id, a retry known', async () => {
    const events = createPrismaSlackEvents(prisma);

    await expect(Promise.all([events.keep(aKeptSlackEvent()), events.keep(aKeptSlackEvent())])).resolves.toEqual(expect.arrayContaining(['kept', 'known']));
    await expect(events.untakenSince(new Date('2026-10-28T00:00:00.000Z'))).resolves.toEqual([aKeptSlackEvent()]);
  });

  it('hands each untaken event to one of two rounds at once, and keeps only its id once taken', async () => {
    const events = createPrismaSlackEvents(prisma);
    await events.keep(aKeptSlackEvent());
    const handed = new Array<string>();
    const send = async (event: ReturnType<typeof aKeptSlackEvent>) => {
      handed.push(event.eventId);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return 'taken' as const;
    };

    await Promise.all([events.sendDue(send, { limit: 10, at: AT }), events.sendDue(send, { limit: 10, at: AT })]);

    expect(handed).toEqual(['Ev01']);
    await expect(prisma.slackEvent.findMany()).resolves.toEqual([expect.objectContaining({ eventId: 'Ev01', markdown: '', takenAt: AT })]);
  });

  it('hands an event sent as later again next round', async () => {
    const events = createPrismaSlackEvents(prisma);
    await events.keep(aKeptSlackEvent());
    let rounds = 0;

    await events.sendDue(() => { rounds += 1; return Promise.resolve('later'); }, { limit: 10, at: AT });
    await events.sendDue(() => { rounds += 1; return Promise.resolve('later'); }, { limit: 10, at: AT });

    expect(rounds).toBe(2);
  });

  it('forgets taken ids before the time given, and removes an event', async () => {
    const events = createPrismaSlackEvents(prisma);
    await events.keep(aKeptSlackEvent({ eventId: 'Ev-old', takenAt: new Date('2026-10-27T07:00:00.000Z'), markdown: '' }));
    await events.keep(aKeptSlackEvent({ eventId: 'Ev-new', takenAt: AT, markdown: '' }));
    await events.keep(aKeptSlackEvent({ eventId: 'Ev-gone' }));

    await events.forgetTaken(new Date('2026-10-27T08:00:00.000Z'));
    await events.remove(ACME, 'Ev-gone');

    await expect(prisma.slackEvent.findMany({ select: { eventId: true } })).resolves.toEqual([{ eventId: 'Ev-new' }]);
  });

  it("forgets a forgotten fleet's events", async () => {
    await createPrismaSlackEvents(prisma).keep(aKeptSlackEvent());

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.slackEvent.count()).resolves.toBe(0);
  });
});
