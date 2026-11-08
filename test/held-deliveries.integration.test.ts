import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaLetGoDeliveries, listenToChanges } from '../src/adapters/prisma/changes.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createHeldDeliveries, holdingDoor, type HeldDeliveries } from '../src/core/people/held-deliveries.js';
import { migratedDatabase } from './support/database.js';
import { aPersonDelivery, fakePersonShipDoor } from './support/people-fakes.js';
import { FIXED_CLOCK } from './support/fixed-clock.js';

// Two gateway instances on one database each hold what waits for the same
// person ship (aeolus-fleet #1647): a delivery one of them acknowledges is let
// go of by the other too, so neither lists it waiting once another arrives.

const CREW = 'aeolus_ct_v1_charlotte';
const QUESTION = aPersonDelivery();
const NOTE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002' });
const HEARD_WITHIN_MS = 5000;

let databaseUrl: string;
let prisma: PrismaClient;
/** Each instance's listening connection, closed after each test. */
let listening: { close(): Promise<void> }[];

beforeEach(async () => {
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
  listening = [];
});

afterEach(async () => {
  for (const each of listening) {
    await each.close();
  }
  await prisma.$disconnect();
});

/** A gateway instance: what it holds, hearing what any instance lets go of, and how often it read everything anew. */
async function anInstance(): Promise<{ held: HeldDeliveries; resyncs: () => number }> {
  const held = createHeldDeliveries(FIXED_CLOCK);
  held.hold(CREW, [QUESTION, NOTE]);
  let resyncs = 0;
  listening.push(
    await listenToChanges(databaseUrl, {
      onChange: () => undefined,
      onLetGo: (deliveryId) => {
        held.letGo(deliveryId);
      },
      onResync: () => {
        resyncs += 1;
        held.forgetAll();
      },
    }),
  );
  return { held, resyncs: () => resyncs };
}

const heldIds = (held: HeldDeliveries) => held.of(CREW)?.map(({ deliveryId }) => deliveryId);

describe('every gateway instance lets go of a delivery any of them acknowledged', () => {
  it('lets go on the other instance of a delivery one acknowledged', async () => {
    const [one, other] = [await anInstance(), await anInstance()];
    const door = holdingDoor(fakePersonShipDoor({ crewToken: CREW, deliveries: [QUESTION, NOTE] }).door, { held: one.held, letGo: createPrismaLetGoDeliveries(prisma) });

    await door.ack(CREW, QUESTION.deliveryId);

    await expect.poll(() => heldIds(other.held), { timeout: HEARD_WITHIN_MS }).toEqual([NOTE.deliveryId]);
  });

  it('keeps what the other instance holds when the fleet refused the acknowledgement', async () => {
    const [one, other] = [await anInstance(), await anInstance()];
    const door = holdingDoor(fakePersonShipDoor({ crewToken: CREW, deliveries: [QUESTION, NOTE] }).door, { held: one.held, letGo: createPrismaLetGoDeliveries(prisma) });

    await door.ack('aeolus_ct_v1_other', QUESTION.deliveryId);
    // A let-go told for the note after it, so once it is heard the refused one would have been too.
    await door.ack(CREW, NOTE.deliveryId);

    await expect.poll(() => heldIds(other.held), { timeout: HEARD_WITHIN_MS }).toEqual([QUESTION.deliveryId]);
  });
});
