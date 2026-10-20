import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { OwnerQuestions } from '../../core/requests/ports.js';
import type { Db } from './client.js';
import { requestOf } from './pending-requests.js';

const questionRowSchema = z.object({
  fleetId: idSchema('fleet'),
  requestId: z.string(),
  questionId: z.string(),
  askedShipId: idSchema('ship').nullable(),
  askedAt: z.date().nullable(),
  withdrawnAt: z.date().nullable(),
});

/**
 * The gateway's questions to its owner in Postgres, read beside the pending
 * requests they are about: a request to ask is open and not expired, and a
 * question to withdraw is about a request that ended, or is forgotten.
 */
export function createPrismaOwnerQuestions(db: Db): OwnerQuestions {
  return {
    listToAsk: async (now, limit) => {
      const rows = await db.$queryRaw<{ questionId: string | null }[]>`
        SELECT r."fleet_id" AS "fleetId", r."request_id" AS "requestId", r."kind", r."client_id" AS "clientId", r."client_name" AS "clientName", r."url", r."requesters",
          r."asked_at" AS "askedAt", r."expires_at" AS "expiresAt", r."state", r."decided_by" AS "decidedBy", r."decided_at" AS "decidedAt", q."question_id" AS "questionId"
        FROM "pending_requests" r
        LEFT JOIN "owner_questions" q ON q."fleet_id" = r."fleet_id" AND q."request_id" = r."request_id"
        WHERE (r."state" = 'approving' OR (r."state" = 'pending' AND r."expires_at" > ${now})) AND q."asked_at" IS NULL
        ORDER BY r."asked_at", r."request_id"
        LIMIT ${limit}`;
      return rows.map((row) => ({ request: requestOf(row), questionId: row.questionId }));
    },
    keep: async (fleetId, { requestId, questionId }) => {
      await db.ownerQuestion.createMany({ data: [{ fleetId, requestId, questionId }], skipDuplicates: true });
      const kept = await db.ownerQuestion.findUniqueOrThrow({ where: { fleetId_requestId: { fleetId, requestId } } });
      return kept.questionId;
    },
    markAsked: async (fleetId, { requestId, askedShipId, at }) => {
      await db.ownerQuestion.update({ where: { fleetId_requestId: { fleetId, requestId } }, data: { askedShipId, askedAt: at } });
    },
    listToWithdraw: async (now, limit) => {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT q."fleet_id" AS "fleetId", q."request_id" AS "requestId", q."question_id" AS "questionId", q."asked_ship_id" AS "askedShipId", q."asked_at" AS "askedAt", q."withdrawn_at" AS "withdrawnAt"
        FROM "owner_questions" q
        LEFT JOIN "pending_requests" r ON r."fleet_id" = q."fleet_id" AND r."request_id" = q."request_id"
        WHERE q."asked_ship_id" IS NOT NULL AND q."withdrawn_at" IS NULL
          AND (r."request_id" IS NULL OR r."state" IN ('approved', 'denied', 'expired') OR (r."state" = 'pending' AND r."expires_at" <= ${now}))
        ORDER BY q."request_id"
        LIMIT ${limit}`;
      return rows.map((row) => questionRowSchema.parse(row));
    },
    markWithdrawn: async (fleetId, { requestId, at }) => {
      await db.ownerQuestion.update({ where: { fleetId_requestId: { fleetId, requestId } }, data: { withdrawnAt: at } });
    },
  };
}
