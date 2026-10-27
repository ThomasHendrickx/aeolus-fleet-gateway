import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { KeptSlackEvent } from '../../core/slack/kept-slack-event.js';
import type { SlackEvents } from '../../core/slack/ports.js';
import type { PrismaClient } from './client.js';
import type { SlackEvent as SlackEventRow } from './generated/client.js';

/** How long one event's send may hold its row: a send waits on the fleet and on Slack. */
const SEND_TIMEOUT_MS = 30_000;

const heldSchema = z.array(z.object({ event_id: z.string() }));

function eventOf(row: SlackEventRow): KeptSlackEvent {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    eventId: row.eventId,
    appId: row.appId,
    shipId: idSchema('ship').parse(row.shipId),
    personShipId: idSchema('ship').parse(row.personShipId),
    channel: row.channel,
    ts: row.ts,
    threadTs: row.threadTs,
    markdown: row.markdown,
    receivedAt: row.receivedAt,
    takenAt: row.takenAt,
  };
}

/**
 * The kept Slack events, one row per fleet and Slack event id. A send holds
 * its event's row (FOR UPDATE SKIP LOCKED), so two gateway instances never
 * send one event at once; another instance's round passes it by.
 */
export function createPrismaSlackEvents(db: PrismaClient): SlackEvents {
  return {
    keep: async (event) => {
      const { count } = await db.slackEvent.createMany({ data: [event], skipDuplicates: true });
      return count === 1 ? 'kept' : 'known';
    },
    sendDue: async (send, { limit, at }) => {
      const due = await db.slackEvent.findMany({ where: { takenAt: null }, select: { fleetId: true, eventId: true }, orderBy: { receivedAt: 'asc' }, take: limit });
      for (const { fleetId, eventId } of due) {
        await db.$transaction(
          async (tx) => {
            const held = heldSchema.parse(await tx.$queryRaw`SELECT "event_id" FROM "slack_events" WHERE "fleet_id" = ${fleetId} AND "event_id" = ${eventId} AND "taken_at" IS NULL FOR UPDATE SKIP LOCKED`);
            const row = held.length === 0 ? null : await tx.slackEvent.findUnique({ where: { fleetId_eventId: { fleetId, eventId } } });
            if (row !== null && (await send(eventOf(row))) === 'taken') {
              await tx.slackEvent.update({ where: { fleetId_eventId: { fleetId, eventId } }, data: { markdown: '', takenAt: at } });
            }
          },
          { timeout: SEND_TIMEOUT_MS },
        );
      }
    },
    forgetTaken: async (before) => {
      await db.slackEvent.deleteMany({ where: { takenAt: { lt: before } } });
    },
    untakenSince: async (before) => (await db.slackEvent.findMany({ where: { takenAt: null, receivedAt: { lt: before } }, orderBy: { receivedAt: 'asc' } })).map(eventOf),
    remove: async (fleetId, eventId) => {
      await db.slackEvent.deleteMany({ where: { fleetId, eventId } });
    },
  };
}
