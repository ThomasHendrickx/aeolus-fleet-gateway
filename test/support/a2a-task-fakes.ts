/** An outside A2A client's task in memory, as SendMessage keeps it: one call to the CRM ship, not yet answered. */
import type { FleetId } from '@aeolus-fleet/common';

import { aClientCall, memoryClientCalls } from './mcp-in-fakes.js';

export const TASK_ID = 'task-1';
export const TASK_SENT_AT = new Date('2026-10-23T12:00:00.000Z');

/** The calls of outside clients, holding one task of the party named. */
export async function callsWithATask(caller: { fleetId: FleetId; party: string }, overrides: { deadlineAt?: Date | null } = {}): Promise<ReturnType<typeof memoryClientCalls>> {
  const calls = memoryClientCalls();
  await calls.saveTask({ ...caller, taskId: TASK_ID, contextId: 'ctx-1', createdAt: TASK_SENT_AT });
  await calls.save(aClientCall({ fleetId: caller.fleetId, party: caller.party, handle: TASK_ID, sentAt: TASK_SENT_AT, deadlineAt: overrides.deadlineAt ?? null, task: { taskId: TASK_ID, message: '{}' } }));
  return calls;
}
