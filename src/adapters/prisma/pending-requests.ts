import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { PendingRequest, PendingRequests, RequestSubject } from '../../core/requests/ports.js';
import type { Db } from './client.js';

const requestersSchema = z.array(z.object({ accountId: z.string(), personShipId: idSchema('ship').nullable() }));
const decidedBySchema = z.union([z.object({ kind: z.literal('ship'), shipId: idSchema('ship') }), z.object({ kind: z.enum(['operator', 'viewer']) })]).nullable();
const toldAccountIdsSchema = z.array(z.string());
const stateSchema = z.enum(['pending', 'approving', 'approved', 'denied', 'expired']);

/** A row as the table holds it, whether read by Prisma or by the raw insert. */
const rowSchema = z.object({
  fleetId: idSchema('fleet'),
  requestId: z.string(),
  kind: z.enum(['client', 'server']),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  url: z.string().nullable(),
  requesters: z.unknown(),
  askedAt: z.date(),
  expiresAt: z.date(),
  state: stateSchema,
  decidedBy: z.unknown(),
  decidedAt: z.date().nullable(),
});

/** What one open request is unique by in its fleet. */
function subjectKeyOf(subject: RequestSubject): string {
  return subject.kind === 'client' ? `client:${subject.clientId}` : `server:${subject.url}`;
}

function requestOf(raw: unknown): PendingRequest {
  const row = rowSchema.parse(raw);
  const subject: RequestSubject =
    row.kind === 'client' ? { kind: 'client', clientId: z.string().parse(row.clientId), clientName: z.string().parse(row.clientName) } : { kind: 'server', url: z.string().parse(row.url) };
  return {
    fleetId: row.fleetId,
    requestId: row.requestId,
    subject,
    requesters: requestersSchema.parse(row.requesters),
    askedAt: row.askedAt,
    expiresAt: row.expiresAt,
    state: row.state,
    decidedBy: decidedBySchema.parse(row.decidedBy),
    decidedAt: row.decidedAt,
  };
}

/**
 * The pending requests in Postgres. Opening is one insert that joins the
 * open request for the same client or server on the partial unique index,
 * so two requesters asking at once share one request; every decision is a
 * conditional update, so the first counts.
 */
export function createPrismaPendingRequests(db: Db): PendingRequests {
  return {
    open: async ({ now, ...request }) => {
      const subjectKey = subjectKeyOf(request.subject);
      const { subject } = request;
      const [requester] = request.requesters;
      await db.pendingRequest.updateMany({ where: { fleetId: request.fleetId, subjectKey, state: 'pending', expiresAt: { lte: now } }, data: { state: 'expired' } });
      const rows = await db.$queryRaw<unknown[]>`
        INSERT INTO "pending_requests" ("fleet_id", "request_id", "kind", "subject_key", "client_id", "client_name", "url", "requesters", "asked_at", "expires_at", "state")
        VALUES (${request.fleetId}, ${request.requestId}, ${subject.kind}, ${subjectKey},
          ${subject.kind === 'client' ? subject.clientId : null}, ${subject.kind === 'client' ? subject.clientName : null}, ${subject.kind === 'server' ? subject.url : null},
          ${JSON.stringify(request.requesters)}::jsonb, ${request.askedAt}, ${request.expiresAt}, 'pending')
        ON CONFLICT ("fleet_id", "subject_key") WHERE "state" IN ('pending', 'approving')
        DO UPDATE SET "requesters" = CASE
          WHEN "pending_requests"."requesters" @> jsonb_build_array(jsonb_build_object('accountId', ${requester?.accountId ?? ''}::text)) THEN "pending_requests"."requesters"
          ELSE "pending_requests"."requesters" || ${JSON.stringify(request.requesters)}::jsonb
        END
        RETURNING "fleet_id" AS "fleetId", "request_id" AS "requestId", "kind", "client_id" AS "clientId", "client_name" AS "clientName", "url", "requesters",
          "asked_at" AS "askedAt", "expires_at" AS "expiresAt", "state", "decided_by" AS "decidedBy", "decided_at" AS "decidedAt"`;
      return requestOf(rows[0]);
    },
    latestAskedBy: async (fleetId, { subject, accountId }) => {
      const row = await db.pendingRequest.findFirst({
        where: { fleetId, subjectKey: subjectKeyOf(subject), requesters: { array_contains: [{ accountId }] } },
        orderBy: { askedAt: 'desc' },
      });
      return row === null ? undefined : { request: requestOf(row), isTold: toldAccountIdsSchema.parse(row.toldAccountIds).includes(accountId) };
    },
    markTold: async (fleetId, { requestId, accountId }) => {
      await db.$executeRaw`
        UPDATE "pending_requests" SET "told_account_ids" = "told_account_ids" || jsonb_build_array(${accountId}::text)
        WHERE "fleet_id" = ${fleetId} AND "request_id" = ${requestId} AND NOT "told_account_ids" @> jsonb_build_array(${accountId}::text)`;
    },
    find: async (fleetId: FleetId, requestId) => {
      const row = await db.pendingRequest.findUnique({ where: { fleetId_requestId: { fleetId, requestId } } });
      return row === null ? undefined : requestOf(row);
    },
    listOpen: async (fleetId, now) => {
      const rows = await db.pendingRequest.findMany({ where: { fleetId, state: { in: ['pending', 'approving'] }, expiresAt: { gt: now } }, orderBy: { askedAt: 'asc' } });
      return rows.map(requestOf);
    },
    claim: async (fleetId, { requestId, now }) => {
      const claimed = await db.pendingRequest.updateMany({ where: { fleetId, requestId, state: 'pending', expiresAt: { gt: now } }, data: { state: 'approving' } });
      return claimed.count === 1;
    },
    release: async (fleetId, requestId) => {
      await db.pendingRequest.updateMany({ where: { fleetId, requestId, state: 'approving' }, data: { state: 'pending' } });
    },
    decide: async (fleetId, { requestId, from, decision }) => {
      const decided = await db.pendingRequest.updateMany({
        where: { fleetId, requestId, state: { in: [...from] } },
        data: { state: decision.outcome, decidedBy: decision.decidedBy, decidedAt: decision.decidedAt },
      });
      return decided.count === 1;
    },
  };
}
