import { idSchema } from '@aeolus-fleet/common';
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
  it('reports only new arrivals or a first sighting as a change', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const outcomes = [];
    outcomes.push(await record.note(ship, { contributions: [contribution], isSeen: false }));
    outcomes.push(await record.note(ship, { contributions: [contribution], isSeen: false }));
    outcomes.push(await record.note(ship, { contributions: [contribution], isSeen: true }));
    outcomes.push(await record.note(ship, { contributions: [contribution], isSeen: true }));
    expect(outcomes).toEqual([true, false, true, false]);
  });

  it('rolls back contribution arrivals with their transaction', async () => {
    await expect(prisma.$transaction(async (db) => {
      await createPrismaMeetingContributions(db).note(ship, { contributions: [contribution], isSeen: false });
      throw new Error('Rollback');
    })).rejects.toThrow('Rollback');
    await expect(createPrismaMeetingContributions(prisma).unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 0 }]);
  });

  it('counts each arriving contribution once across concurrent receives and a restart', async () => {
    const record = createPrismaMeetingContributions(prisma);
    await Promise.all(Array.from({ length: 4 }, () => record.note(ship, { contributions: [contribution], isSeen: false })));
    const restarted = createPrismaMeetingContributions(prisma);
    await expect(restarted.unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });

  it('marks only the displayed contributions seen, shared by every device', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const next = { ...contribution, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0002' } as const;
    await record.note(ship, { contributions: [contribution, next], isSeen: false });
    await record.note(ship, { contributions: [contribution], isSeen: true });
    await record.note(ship, { contributions: [contribution], isSeen: false });
    await expect(createPrismaMeetingContributions(prisma).unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });

  it('keeps a contribution seen when its arrival races with its displayed page', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const shown = { ...contribution, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0003' } as const;
    await Promise.all([record.note(ship, { contributions: [shown], isSeen: true }), record.note(ship, { contributions: [shown], isSeen: false })]);
    await record.note(ship, { contributions: [shown], isSeen: false });
    await expect(record.unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 0 }]);
  });

  it('treats pre-release contributions as seen without backfill and includes the exact release boundary', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const migration = await prisma.$queryRaw<{ started_at: Date }[]>`SELECT started_at FROM _prisma_migrations WHERE migration_name = '20261121100000_meeting_contributions'`;
    const startedAt = migration[0]?.started_at;
    expect(startedAt).toBeInstanceOf(Date);
    if (startedAt === undefined) { return; }
    const other = { ...ship, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8pq' } as const;
    await record.note(other, { contributions: [{ ...contribution, sentAt: new Date(startedAt.getTime() - 1) }], isSeen: false });
    await expect(record.unseen(other, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 0 }]);
    await record.note(other, { contributions: [{ ...contribution, sentAt: startedAt }], isSeen: false });
    await expect(record.unseen(other, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });

  it('isolates fleets, people and meetings and forgets only the requested fleet', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const other = { ...ship, fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz' } as const;
    const otherMeeting = 'mtg_01m5qa5j85mgd4z61d9c2k0002';
    await record.note(ship, { contributions: [contribution], isSeen: false });
    await record.note(other, { contributions: [contribution, { ...contribution, meetingId: otherMeeting }], isSeen: false });
    await expect(record.unseen(other, [HEADS_MEETING_ID, otherMeeting])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }, { meetingId: otherMeeting, count: 1 }]);
    await createPrismaFleetForgetter(prisma).forget(other.fleetId);
    await expect(record.unseen(other, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 0 }]);
    await expect(record.unseen(ship, [HEADS_MEETING_ID])).resolves.toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
  });
});

/** Distinct meetings and chronological message ids, independent of arrival order. */
function aContribution(number: number) {
  return {
    meetingId: idSchema('meeting').parse(`mtg_${String(number).padStart(26, '0')}`),
    messageId: idSchema('message').parse(`msg_${String(number).padStart(26, '0')}`),
    sentAt: new Date('2099-01-01T00:00:00Z'),
  };
}

describe('meetings with something new in the person record', () => {
  it('finds a meeting beyond the first meetings page without a list of meeting ids', async () => {
    const record = createPrismaMeetingContributions(prisma);
    await record.note(ship, { contributions: Array.from({ length: 20 }, (_, index) => aContribution(index + 1)), isSeen: true });
    const beyond = aContribution(21);
    await record.note(ship, { contributions: [beyond], isSeen: false });
    await expect(record.unseenMeetings(ship)).resolves.toEqual([{ meetingId: beyond.meetingId, count: 1 }]);
  });

  it.each([20, 21])('bounds %s meetings to the newest twenty with their complete unseen counts', async (total) => {
    const record = createPrismaMeetingContributions(prisma);
    // Arrival order differs from message order. The oldest meeting has the newest contribution.
    for (let number = total; number > 0; number -= 1) {
      await record.note(ship, { contributions: [aContribution(number)], isSeen: false });
    }
    const newest = { ...aContribution(30), meetingId: aContribution(1).meetingId };
    await record.note(ship, { contributions: [newest], isSeen: false });
    await record.note(ship, { contributions: [newest], isSeen: false });
    const expected = [
      { meetingId: aContribution(1).meetingId, count: 2 },
      ...Array.from({ length: 19 }, (_, index) => ({ meetingId: aContribution(total - index).meetingId, count: 1 })),
    ];
    await expect(createPrismaMeetingContributions(prisma).unseenMeetings(ship)).resolves.toEqual(expected);
  });

  it('excludes seen records and other fleets and people, including when they have newer contributions', async () => {
    const record = createPrismaMeetingContributions(prisma);
    await record.note(ship, { contributions: [aContribution(1), aContribution(2)], isSeen: false });
    await record.note(ship, { contributions: [aContribution(2), aContribution(30)], isSeen: true });
    await record.note({ ...ship, fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz' }, { contributions: [aContribution(40)], isSeen: false });
    await record.note({ ...ship, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8pq' }, { contributions: [aContribution(50)], isSeen: false });
    await expect(record.unseenMeetings(ship)).resolves.toEqual([{ meetingId: aContribution(1).meetingId, count: 1 }]);
    await record.note(ship, { contributions: [aContribution(1)], isSeen: true });
    await expect(record.unseenMeetings(ship)).resolves.toEqual([]);
  });

  it('orders by the newest remaining unseen contribution after a page is read', async () => {
    const record = createPrismaMeetingContributions(prisma);
    const newest = { ...aContribution(3), meetingId: aContribution(1).meetingId };
    await record.note(ship, { contributions: [aContribution(1), aContribution(2), newest], isSeen: false });
    await record.note(ship, { contributions: [newest], isSeen: true });
    await expect(record.unseenMeetings(ship)).resolves.toEqual([
      { meetingId: aContribution(2).meetingId, count: 1 },
      { meetingId: aContribution(1).meetingId, count: 1 },
    ]);
  });
});
