import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaArgoWakes } from '../src/adapters/prisma/argo-wakes.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaWakesSent } from '../src/adapters/prisma/wakes-sent.js';
import { migratedDatabase } from './support/database.js';

// argo's wakes of each person ship, kept apart from its own (argo's inbox,
// AI4, AI5): what they covered, so each message to argo wakes a person once,
// across restarts and instances, and each channel's window.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const THOMAS_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const MATHILDE_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pr';
const THOMAS = { fleetId: FLEET, shipId: THOMAS_SHIP };
const MATHILDE = { fleetId: FLEET, shipId: MATHILDE_SHIP };
const THOMAS_ELSEWHERE = { fleetId: OTHER_FLEET, shipId: THOMAS.shipId };
const LOW_ON_DISK: MessageId = 'msg_01m3tbfspe96yf1rnr4ank9001';
const OUT_OF_CREDIT: MessageId = 'msg_01m3tbfspe96yf1rnr4ank9002';
const SENT_AT = new Date('2026-11-01T20:12:00.000Z');
const LATER = new Date('2026-11-01T20:23:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("argo's wakes in Postgres (argo's inbox, AI5)", () => {
  it('keeps the messages each person ship was covered for, once each, by fleet', async () => {
    const wakes = createPrismaArgoWakes(prisma);
    await wakes.cover(THOMAS, [LOW_ON_DISK]);
    await wakes.cover(THOMAS, [LOW_ON_DISK, OUT_OF_CREDIT]);
    await wakes.cover(THOMAS_ELSEWHERE, [LOW_ON_DISK]);

    const covered = await Promise.all([wakes.coveredOf(THOMAS), wakes.coveredOf(MATHILDE), wakes.coveredOf(THOMAS_ELSEWHERE)]);

    expect(covered.map((messageIds) => [...messageIds].sort())).toEqual([[LOW_ON_DISK, OUT_OF_CREDIT], [], [LOW_ON_DISK]]);
  });

  it('forgets what is no longer open at argo for that person ship only', async () => {
    const wakes = createPrismaArgoWakes(prisma);
    await wakes.cover(MATHILDE, [OUT_OF_CREDIT]);

    await wakes.forgetAllBut(THOMAS, [OUT_OF_CREDIT]);

    const covered = await Promise.all([wakes.coveredOf(THOMAS), wakes.coveredOf(MATHILDE), wakes.coveredOf(THOMAS_ELSEWHERE)]);
    expect(covered.map((messageIds) => [...messageIds])).toEqual([[OUT_OF_CREDIT], [OUT_OF_CREDIT], [LOW_ON_DISK]]);
  });

  it("keeps each channel's last argo wake per person ship, apart from the person's own", async () => {
    const wakes = createPrismaArgoWakes(prisma);
    const own = createPrismaWakesSent(prisma);
    await wakes.record({ ship: THOMAS, channel: 'web-push', sentAt: SENT_AT });
    await wakes.record({ ship: THOMAS, channel: 'web-push', sentAt: LATER });
    await own.record({ ship: THOMAS, channel: 'email', sentAt: SENT_AT });

    const sent = await Promise.all([wakes.lastSentAt(THOMAS, 'web-push'), wakes.lastSentAt(THOMAS, 'email'), wakes.lastSentAt(MATHILDE, 'web-push'), own.lastSentAt(THOMAS, 'web-push')]);

    expect(sent).toEqual([LATER, undefined, undefined, undefined]);
  });

  it('are forgotten with their fleet', async () => {
    const wakes = createPrismaArgoWakes(prisma);

    await createPrismaFleetForgetter(prisma).forget(FLEET);

    const left = await Promise.all([wakes.coveredOf(THOMAS), wakes.lastSentAt(THOMAS, 'web-push'), wakes.coveredOf(THOMAS_ELSEWHERE)]);
    expect([[...left[0]], left[1], [...left[2]]]).toEqual([[], undefined, [LOW_ON_DISK]]);
  });
});
