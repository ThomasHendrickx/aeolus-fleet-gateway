import { idSchema, type FleetId, type MessageId } from '@aeolus-fleet/common';

import type { ClientCall } from '../../core/mcp-in/client-call.js';
import type { ClientCalls } from '../../core/mcp-in/ports.js';
import type { Db } from './client.js';

/** Outside clients' calls, one row per message in a fleet, and their replies, one row per delivery. */
export function createPrismaClientCalls(db: Db): ClientCalls {
  const read = async (where: { fleetId_messageId: { fleetId: FleetId; messageId: MessageId } } | { fleetId_handle: { fleetId: FleetId; handle: string } }): Promise<ClientCall | undefined> => {
    const row = await db.clientCall.findUnique({ where });
    if (!row) {
      return undefined;
    }
    const replies = await db.clientCallReply.findMany({ where: { fleetId: row.fleetId, callMessageId: row.messageId }, orderBy: { sequence: 'asc' } });
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
      replies: replies.map((reply) => ({
        deliveryId: idSchema('delivery').parse(reply.deliveryId),
        messageId: idSchema('message').parse(reply.messageId),
        contentType: reply.contentType,
        payload: reply.payload,
        receivedAt: reply.receivedAt,
      })),
    };
  };
  return {
    save: async ({ fleetId, party, messageId, handle, shipId, capability, outputContentType, sentAt, deadlineAt }) => {
      // The same send again answers the same message: the call kept first stays.
      await db.clientCall.upsert({
        where: { fleetId_messageId: { fleetId, messageId } },
        create: { fleetId, party, messageId, handle, shipId, capability, outputContentType, sentAt, deadlineAt },
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
  };
}
