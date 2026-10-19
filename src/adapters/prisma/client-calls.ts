import { idSchema } from '@aeolus-fleet/common';

import type { ClientCall, ClientCalls } from '../../core/mcp-in/ports.js';
import type { Db } from './client.js';

/** Outside clients' calls, one row per message in a fleet. */
export function createPrismaClientCalls(db: Db): ClientCalls {
  return {
    save: async (call) => {
      const { fleetId, messageId } = call;
      // The same send again answers the same message: the call kept first stays.
      await db.clientCall.upsert({ where: { fleetId_messageId: { fleetId, messageId } }, create: { ...call }, update: {} });
    },
    findByHandle: async ({ fleetId, party }, handle) => {
      const row = await db.clientCall.findUnique({ where: { fleetId_handle: { fleetId, handle } } });
      if (row?.party !== party) {
        return undefined;
      }
      const call: ClientCall = {
        fleetId: idSchema('fleet').parse(row.fleetId),
        party: row.party,
        messageId: idSchema('message').parse(row.messageId),
        handle: row.handle,
        shipId: idSchema('ship').parse(row.shipId),
        capability: row.capability,
        sentAt: row.sentAt,
      };
      return call;
    },
  };
}
