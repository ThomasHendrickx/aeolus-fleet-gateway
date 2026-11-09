import { afterAll, beforeAll, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUnreadableReplies } from '../src/adapters/prisma/unreadable-replies.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { FLEET_ID } from './support/fleet-fakes.js';
import { PERSON_SHIP_ID } from './support/sign-in-fakes.js';
import { SENT_MESSAGE_ID } from './support/people-fakes.js';
import { migratedDatabase } from './support/database.js';

let prisma: PrismaClient;
beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});
afterAll(async () => { await prisma.$disconnect(); });

it('keeps sent rejection replies across restarts, scoped by fleet and person ship, and forgets only their fleet', async () => {
  const replies = createPrismaUnreadableReplies(prisma);
  const reply = { shipId: PERSON_SHIP_ID, messageId: SENT_MESSAGE_ID };
  const look = { shipId: PERSON_SHIP_ID, messageIds: [SENT_MESSAGE_ID] };
  const otherFleet = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
  await Promise.all([replies.save(FLEET_ID, reply), replies.save(FLEET_ID, reply)]);
  await replies.save(otherFleet, reply);
  const restarted = createPrismaUnreadableReplies(prisma);
  expect(await restarted.among(FLEET_ID, look)).toEqual(new Set([SENT_MESSAGE_ID]));
  expect(await restarted.among(FLEET_ID, { ...look, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8pp' })).toEqual(new Set());
  expect(await restarted.among('flt_01m3tb1zgr5h2ffee12xnch8yy', look)).toEqual(new Set());
  await createPrismaFleetForgetter(prisma).forget(FLEET_ID);
  expect(await restarted.among(FLEET_ID, look)).toEqual(new Set());
  expect(await restarted.among(otherFleet, look)).toEqual(new Set([SENT_MESSAGE_ID]));
});
