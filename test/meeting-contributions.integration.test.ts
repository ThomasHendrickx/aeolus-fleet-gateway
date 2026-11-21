import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaMeetingContributions } from '../src/adapters/prisma/meeting-contributions.js';
import { FLEET_ID } from './support/fleet-fakes.js';
import { HEADS_MEETING_ID } from './support/meeting-fakes.js';
import { PERSON_SHIP_ID } from './support/sign-in-fakes.js';
import { migratedDatabase } from './support/database.js';

let prisma: PrismaClient;
const ship = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const contribution = { meetingId: HEADS_MEETING_ID, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0001', sentAt: new Date('2099-01-01T00:00:00Z') } as const;

beforeAll(async () => { prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl'))); });
beforeEach(async () => { await prisma.$executeRaw`DELETE FROM meeting_contributions`; });
afterAll(async () => { await prisma.$disconnect(); });

describe('the person record of meeting contributions', () => {
  it('counts each arriving contribution once across concurrent receives and a restart', async () => {
    const record = createPrismaMeetingContributions(prisma);
    await Promise.all(Array.from({ length: 4 }, () => record.note(ship, [contribution], false)));
    const restarted = createPrismaMeetingContributions(prisma);
    await expect(restarted.unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });

  it('marks only the displayed contributions seen, shared by every device', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const next = { ...contribution, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0002' } as const;
    await record.note(ship, [contribution, next], false);
    await record.note(ship, [contribution], true);
    await record.note(ship, [contribution], false);
    await expect(createPrismaMeetingContributions(prisma).unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });

  it('keeps a contribution seen when its arrival races with its displayed page', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const shown = { ...contribution, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0003' } as const;
    await Promise.all([record.note(ship, [shown], true), record.note(ship, [shown], false)]);
    await record.note(ship, [shown], false);
    await expect(record.unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 0 }]);
  });

  it('treats pre-release contributions as seen without backfill and includes the exact release boundary', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const migration = await prisma.$queryRaw<{ started_at: Date }[]>`SELECT started_at FROM _prisma_migrations WHERE migration_name = '20261121100000_meeting_contributions'`;
    const startedAt = migration[0]?.started_at;
    expect(startedAt).toBeInstanceOf(Date);
    if (startedAt === undefined) { return; }
    const other = { ...ship, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8pq' } as const;
    await record.note(other, [{ ...contribution, sentAt: new Date(startedAt.getTime() - 1) }], false);
    await expect(record.unseen(other, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 0 }]);
    await record.note(other, [{ ...contribution, sentAt: startedAt }], false);
    await expect(record.unseen(other, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });

  it('isolates fleets, people and meetings and forgets only the requested fleet', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const other = { ...ship, fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz' } as const;
    const otherMeeting = 'mtg_01m5qa5j85mgd4z61d9c2k0002';
    await record.note(ship, [contribution], false);
    await record.note(other, [contribution, { ...contribution, meetingId: otherMeeting }], false);
    await expect(record.unseen(other, [HEADS_MEETING_ID, otherMeeting])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }, { meetingId: otherMeeting, count: 1 }]);
    await createPrismaFleetForgetter(prisma).forget(other.fleetId);
    await expect(record.unseen(other, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 0 }]);
    await expect(record.unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });
});
