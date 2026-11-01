import { idSchema } from '@aeolus-fleet/common';

import type { SlackLinkStep, SlackLinkSteps } from '../../core/slack/ports.js';
import type { PrismaClient } from './client.js';

type SlackLinkStepRow = NonNullable<Awaited<ReturnType<PrismaClient['slackLinkStep']['findUnique']>>>;

function stepOf(row: SlackLinkStepRow): SlackLinkStep {
  return { stepId: row.stepId, isTold: row.isTold, stepMessageId: row.stepMessageId === null ? null : idSchema('message').parse(row.stepMessageId) };
}

/**
 * The asks to link Slack, one row per person ship while open: opening one
 * inserts it unless a row is there, so two reads at once keep the first
 * uuid, and a link deletes it.
 */
export function createPrismaSlackLinkSteps(db: PrismaClient): SlackLinkSteps {
  return {
    open: async (fleetId, { personShipId, stepId }) => {
      // ON CONFLICT DO NOTHING: of two reads opening it at once, both read the one row the first inserted.
      await db.slackLinkStep.createMany({ data: [{ fleetId, personShipId, stepId }], skipDuplicates: true });
      return stepOf(await db.slackLinkStep.findUniqueOrThrow({ where: { fleetId_personShipId: { fleetId, personShipId } } }));
    },
    markTold: async (fleetId, { personShipId, stepMessageId }) => {
      await db.slackLinkStep.updateMany({ where: { fleetId, personShipId }, data: { isTold: true, stepMessageId } });
    },
    close: async (fleetId, personShipId) => {
      const found = await db.slackLinkStep.findUnique({ where: { fleetId_personShipId: { fleetId, personShipId } } });
      // Of two links closing it at once, only the one whose delete took the row answers it.
      const { count } = await db.slackLinkStep.deleteMany({ where: { fleetId, personShipId } });
      return found === null || count === 0 ? undefined : stepOf(found);
    },
  };
}
