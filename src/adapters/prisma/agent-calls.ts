/**
 * The gateway's messages to outside A2A agents (slice 6), by delivery, and
 * which task each reply it sent tells of. Every query but a delivery's own
 * is scoped by fleet and party; a delivery id is the fleet's, unique across
 * fleets, as the MCP out calls are kept.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { AgentCall, AgentCalls } from '../../core/a2a-out/ports.js';
import type { PrismaClient } from './client.js';

const stateSchema = z.enum(['sending', 'notSent', 'following', 'mayHaveRun', 'done']);

interface Row {
  deliveryId: string;
  fleetId: string;
  party: string;
  messageId: string;
  senderShipId: string;
  state: string;
  taskId: string | null;
  contextId: string | null;
  deadlineAt: Date;
}

function callOf(row: Row): AgentCall {
  return {
    deliveryId: idSchema('delivery').parse(row.deliveryId),
    fleetId: idSchema('fleet').parse(row.fleetId),
    party: row.party,
    messageId: idSchema('message').parse(row.messageId),
    senderShipId: idSchema('ship').parse(row.senderShipId),
    state: stateSchema.parse(row.state),
    taskId: row.taskId,
    contextId: row.contextId,
    deadlineAt: row.deadlineAt,
  };
}

export function createPrismaAgentCalls(db: PrismaClient): AgentCalls {
  return {
    find: async (deliveryId) => {
      const row = await db.a2aAgentCall.findUnique({ where: { deliveryId } });
      return row === null ? undefined : callOf(row);
    },
    save: async (call) => {
      const { deliveryId, ...rest } = call;
      await db.a2aAgentCall.upsert({ where: { deliveryId }, create: call, update: rest });
    },
    following: async ({ fleetId, party }) => (await db.a2aAgentCall.findMany({ where: { fleetId, party, state: 'following' }, orderBy: { deliveryId: 'asc' } })).map(callOf),
    saveReply: async ({ fleetId, party }, { messageId, taskId, contextId }) => {
      await db.a2aAgentReply.upsert({ where: { fleetId_party_messageId: { fleetId, party, messageId } }, create: { fleetId, party, messageId, taskId, contextId }, update: {} });
    },
    taskOfReply: async ({ fleetId, party }, messageId) => {
      const row = await db.a2aAgentReply.findUnique({ where: { fleetId_party_messageId: { fleetId, party, messageId } } });
      return row === null ? undefined : { taskId: row.taskId, contextId: row.contextId };
    },
  };
}
