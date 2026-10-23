import { idSchema, type FleetId, type MessageId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { CallReply, ClientCall, DeliveryState } from '../../core/mcp-in/client-call.js';
import type { ClientCalls, StoredTask } from '../../core/mcp-in/ports.js';
import type { Db } from './client.js';

const deliveryStateSchema: z.ZodType<DeliveryState> = z.enum(['pending', 'received', 'handed', 'acknowledged', 'handled', 'notHandled', 'undeliverable', 'dismissed', 'abandoned']);

/** Where a page of tasks ends: the last task's time and id, as an opaque cursor. */
const cursorSchema = z.object({ createdAt: z.iso.datetime(), taskId: z.string() });

/** A cursor as sent back, or none for one this store did not write. */
function cursorOf(after: string): z.infer<typeof cursorSchema> | undefined {
  try {
    return cursorSchema.safeParse(JSON.parse(Buffer.from(after, 'base64url').toString('utf8'))).data;
  } catch {
    return undefined;
  }
}

interface CallRow {
  fleetId: string;
  party: string;
  messageId: string;
  handle: string;
  shipId: string;
  capability: string | null;
  outputContentType: string | null;
  sentAt: Date;
  deadlineAt: Date | null;
  deliveryState: string | null;
  deliverySince: Date | null;
  taskId: string | null;
  taskMessage: string | null;
}

interface ReplyRow {
  deliveryId: string;
  messageId: string;
  contentType: string;
  payload: string;
  receivedAt: Date;
}

function replyOf(row: ReplyRow): CallReply {
  return { deliveryId: idSchema('delivery').parse(row.deliveryId), messageId: idSchema('message').parse(row.messageId), contentType: row.contentType, payload: row.payload, receivedAt: row.receivedAt };
}

function callOf(row: CallRow, replies: readonly ReplyRow[]): ClientCall {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    party: row.party,
    messageId: idSchema('message').parse(row.messageId),
    handle: row.handle,
    shipId: idSchema('ship').parse(row.shipId),
    capability: row.capability,
    outputContentType: row.outputContentType,
    sentAt: row.sentAt,
    deadlineAt: row.deadlineAt,
    delivery: row.deliveryState === null || row.deliverySince === null ? null : { state: deliveryStateSchema.parse(row.deliveryState), since: row.deliverySince },
    task: row.taskId === null || row.taskMessage === null ? null : { taskId: row.taskId, message: row.taskMessage },
    replies: replies.map(replyOf),
  };
}

/** Outside clients' calls, one row per message in a fleet, and their replies, one row per delivery; A2A tasks, one row per task. */
export function createPrismaClientCalls(db: Db): ClientCalls {
  const read = async (where: { fleetId_messageId: { fleetId: FleetId; messageId: MessageId } } | { fleetId_handle: { fleetId: FleetId; handle: string } }): Promise<ClientCall | undefined> => {
    const row = await db.clientCall.findUnique({ where });
    if (!row) {
      return undefined;
    }
    const replies = await db.clientCallReply.findMany({ where: { fleetId: row.fleetId, callMessageId: row.messageId }, orderBy: { sequence: 'asc' } });
    return callOf(row, replies);
  };

  /** The calls of these tasks with their replies, in two queries whatever the number of tasks, each task's calls in the order sent. */
  const callsOfTasks = async (fleetId: FleetId, taskIds: readonly string[]): Promise<Map<string, ClientCall[]>> => {
    const rows = await db.clientCall.findMany({ where: { fleetId, taskId: { in: [...taskIds] } }, orderBy: [{ sentAt: 'asc' }, { messageId: 'asc' }] });
    const replies = await db.clientCallReply.findMany({ where: { fleetId, callMessageId: { in: rows.map((row) => row.messageId) } }, orderBy: { sequence: 'asc' } });
    const byTask = new Map<string, ClientCall[]>();
    for (const row of rows) {
      const call = callOf(
        row,
        replies.filter((reply) => reply.callMessageId === row.messageId),
      );
      byTask.set(row.taskId ?? '', [...(byTask.get(row.taskId ?? '') ?? []), call]);
    }
    return byTask;
  };

  return {
    save: async ({ fleetId, party, messageId, handle, shipId, capability, outputContentType, sentAt, deadlineAt, delivery, task }) => {
      // The same send again answers the same message: the call kept first stays.
      await db.clientCall.upsert({
        where: { fleetId_messageId: { fleetId, messageId } },
        create: { fleetId, party, messageId, handle, shipId, capability, outputContentType, sentAt, deadlineAt, deliveryState: delivery?.state ?? null, deliverySince: delivery?.since ?? null, taskId: task?.taskId ?? null, taskMessage: task?.message ?? null },
        update: {},
      });
    },
    addReply: async ({ fleetId, messageId }, reply) => {
      // A delivery handed again after a lost acknowledgement is kept once.
      const { deliveryId, contentType, payload, receivedAt } = reply;
      await db.clientCallReply.upsert({ where: { deliveryId }, create: { deliveryId, fleetId, callMessageId: messageId, messageId: reply.messageId, contentType, payload, receivedAt }, update: {} });
    },
    findByMessage: (fleetId, messageId) => read({ fleetId_messageId: { fleetId, messageId } }),
    waitedOn: async ({ fleetId, party }, now) => {
      const rows = await db.clientCall.findMany({
        where: { fleetId, party, OR: [{ deadlineAt: null }, { deadlineAt: { gt: now } }] },
        orderBy: { sentAt: 'asc' },
        select: { messageId: true },
      });
      const calls = await Promise.all(rows.map(({ messageId }) => read({ fleetId_messageId: { fleetId, messageId: idSchema('message').parse(messageId) } })));
      return calls.filter((call) => call !== undefined);
    },
    findByHandle: async ({ fleetId, party }, handle) => {
      const call = await read({ fleetId_handle: { fleetId, handle } });
      return call?.party === party ? call : undefined;
    },
    setDelivery: async ({ fleetId, messageId }, delivery) => {
      await db.clientCall.updateMany({ where: { fleetId, messageId }, data: { deliveryState: delivery.state, deliverySince: delivery.since } });
    },
    saveTask: async ({ fleetId, party, taskId, contextId, createdAt }) => {
      // A send again after a lost answer keeps the task kept first.
      await db.a2aTask.upsert({ where: { fleetId_taskId: { fleetId, taskId } }, create: { fleetId, party, taskId, contextId, createdAt }, update: {} });
    },
    findTask: async ({ fleetId, party }, taskId) => {
      const task = await db.a2aTask.findUnique({ where: { fleetId_taskId: { fleetId, taskId } } });
      if (task?.party !== party) {
        return undefined;
      }
      const calls = await callsOfTasks(fleetId, [taskId]);
      return { taskId, contextId: task.contextId, calls: calls.get(taskId) ?? [] };
    },
    listTasks: async ({ fleetId, party }, { limit, after, contextId }) => {
      const cursor = after === undefined ? undefined : cursorOf(after);
      if (after !== undefined && cursor === undefined) {
        return { tasks: [], next: null };
      }
      const rows = await db.a2aTask.findMany({
        where: {
          fleetId,
          party,
          ...(contextId === undefined ? {} : { contextId }),
          ...(cursor === undefined ? {} : { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), taskId: { lt: cursor.taskId } }] }),
        },
        orderBy: [{ createdAt: 'desc' }, { taskId: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const calls = await callsOfTasks(fleetId, page.map((row) => row.taskId));
      const last = page.at(-1);
      const tasks: StoredTask[] = page.map((row) => ({ taskId: row.taskId, contextId: row.contextId, calls: calls.get(row.taskId) ?? [] }));
      return { tasks, next: rows.length > limit && last !== undefined ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), taskId: last.taskId })).toString('base64url') : null };
    },
  };
}
