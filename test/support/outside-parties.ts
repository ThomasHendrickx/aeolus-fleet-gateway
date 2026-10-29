import type { FleetId } from '@aeolus-fleet/common';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaOutsidePartySwitches } from '../../src/adapters/prisma/outside-party-switches.js';

/**
 * Turns the fleet's outside parties on in the gateway's database, as an actor
 * holding fleet:network does with outsideParties.set once the fleet applies
 * network rules; set here, so a test needs no such actor.
 */
export async function outsidePartiesOn(databaseUrl: string, fleetId: FleetId): Promise<void> {
  const prisma = createPrismaClient(databaseUrl);
  await createPrismaOutsidePartySwitches(prisma).set(fleetId, { isOn: true, at: new Date() });
  await prisma.$disconnect();
}
