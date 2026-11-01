import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaSlackLinkSteps } from '../src/adapters/prisma/slack-link-steps.js';
import { migratedDatabase } from './support/database.js';

// Each person's open ask to link Slack (Bridge, BG7), one per person ship
// until a link closes it. Two reads at once keep one ask.

const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const LABS: FleetId = 'flt_01m4ajt7abh4rypkmdnjene67g';
const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const STEP_MESSAGE = 'msg_01m3tbfspe96yf1rnr4ank9m01';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("asks to link Slack in the gateway's database", () => {
  it('keeps the first uuid of two asks opened at once, in its fleet only', async () => {
    const steps = createPrismaSlackLinkSteps(prisma);

    const opened = await Promise.all([steps.open(ACME, { personShipId: MATHILDE_SHIP, stepId: 'step-one' }), steps.open(ACME, { personShipId: MATHILDE_SHIP, stepId: 'step-two' })]);
    const other = await steps.open(LABS, { personShipId: MATHILDE_SHIP, stepId: 'step-labs' });

    expect(new Set(opened.map(({ stepId }) => stepId)).size).toBe(1);
    expect(other).toEqual({ stepId: 'step-labs', isTold: false, stepMessageId: null });
  });

  it('marks an ask told with its step message, and a link closes it once', async () => {
    const steps = createPrismaSlackLinkSteps(prisma);
    await prisma.slackLinkStep.deleteMany({ where: { fleetId: ACME } });
    await steps.open(ACME, { personShipId: MATHILDE_SHIP, stepId: 'step-one' });

    await steps.markTold(ACME, { personShipId: MATHILDE_SHIP, stepMessageId: STEP_MESSAGE });
    const closed = await Promise.all([steps.close(ACME, MATHILDE_SHIP), steps.close(ACME, MATHILDE_SHIP)]);

    expect(closed.filter((step) => step !== undefined)).toEqual([{ stepId: 'step-one', isTold: true, stepMessageId: STEP_MESSAGE }]);
    await expect(steps.open(ACME, { personShipId: MATHILDE_SHIP, stepId: 'step-after' })).resolves.toEqual({ stepId: 'step-after', isTold: false, stepMessageId: null });
  });

  it("forgets a forgotten fleet's asks", async () => {
    await createPrismaSlackLinkSteps(prisma).open(ACME, { personShipId: 'shp_01m3tbfspe96yf1rnr4ank9j0r', stepId: 'step-forgotten' });

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.slackLinkStep.count({ where: { fleetId: ACME } })).resolves.toBe(0);
  });
});
