import type { FleetId } from '@aeolus-fleet/common';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaOutsidePartySwitches } from '../../src/adapters/prisma/outside-party-switches.js';

/**
 * Turns the fleet's outside parties on in the gateway's database, as an actor
 * holding fleet:network does once the fleet applies network rules. Core 0.27
 * answers no fleet.networkRules (aeolus-fleet #997), so the switch is set
 * here rather than through the API.
 */
export async function outsidePartiesOn(databaseUrl: string, fleetId: FleetId): Promise<void> {
  const prisma = createPrismaClient(databaseUrl);
  await createPrismaOutsidePartySwitches(prisma).set(fleetId, { isOn: true, at: new Date() });
  await prisma.$disconnect();
}
