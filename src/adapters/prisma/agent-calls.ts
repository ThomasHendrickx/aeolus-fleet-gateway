/**
 * The gateway's messages to outside A2A agents (slice 6), by delivery, and
 * which task each reply it sent tells of. Every query is scoped by fleet
 * and party.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { AgentCall, AgentCalls } from '../../core/a2a-out/ports.js';
import type { PrismaClient } from './client.js';
import { Prisma } from './generated/client.js';

const stateSchema = z.enum(['sending', 'notSent', 'answered', 'following', 'mayHaveRun', 'done']);
const chunkPlacesSchema = z.record(z.string(), z.number());
const answerSchema = z.object({ contentType: z.string(), payload: z.string(), key: z.string() }).nullable();

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
  answer: unknown;
  replied: string[];
  chunkPlaces: unknown;
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
    answer: answerSchema.parse(row.answer ?? null),
    replied: row.replied,
    chunkPlaces: chunkPlacesSchema.parse(row.chunkPlaces),
  };
}

export function createPrismaAgentCalls(db: PrismaClient): AgentCalls {
  return {
    find: async ({ fleetId, party }, deliveryId) => {
      const row = await db.a2aAgentCall.findFirst({ where: { fleetId, party, deliveryId } });
      return row === null ? undefined : callOf(row);
    },
    save: async (call) => {
      const { fleetId, deliveryId, answer, replied, chunkPlaces, ...rest } = call;
      const data = { ...rest, answer: answer === null ? Prisma.DbNull : { ...answer }, replied: [...replied], chunkPlaces: { ...chunkPlaces } };
      await db.a2aAgentCall.upsert({ where: { fleetId_deliveryId: { fleetId, deliveryId } }, create: { fleetId, deliveryId, ...data }, update: data });
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
