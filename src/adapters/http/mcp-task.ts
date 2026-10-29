/**
 * An outside client's call as an MCP task (the Tasks extension,
 * io.modelcontextprotocol/tasks, 2026-07-28). The task id is the call's
 * handle, already an HMAC of its message id; the call store is the task's
 * durable state, so the task exists once the call was kept (interop 3.3).
 * Submitted and working are both MCP's working (interop 3.4).
 */
import { INTERNAL_ERROR } from '@modelcontextprotocol/server';

import type { ReadCall } from '../../core/mcp-in/read-client-call.js';

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';

/** How often a client reads a task: the fleet answers in seconds, not milliseconds. */
const POLL_INTERVAL_MS = 2000;

/** What a failed call's task says: the ship never answered, and it may have run. */
export const DEADLINE_PASSED = 'The call got no answer before its deadline. It may have run all the same.';

/** The fields every task carries. The gateway keeps every call, so no task expires. */
function taskFieldsOf(read: ReadCall) {
  return { taskId: read.handle, createdAt: read.createdAt.toISOString(), lastUpdatedAt: read.updatedAt.toISOString(), ttlMs: null, pollIntervalMs: POLL_INTERVAL_MS };
}

/** The task tools/call answers in place of its result, for a call not answered within its wait. */
export function createdTaskOf(read: ReadCall) {
  return { resultType: 'task' as const, ...taskFieldsOf(read), status: 'working' as const };
}

/** The task tasks/get answers: a completed call carries its answer as the tool's result, which resultOf gives. */
export function taskOf(read: ReadCall, resultOf: (read: ReadCall) => Record<string, unknown>) {
  const task = { resultType: 'complete' as const, ...taskFieldsOf(read) };
  switch (read.state) {
    case 'submitted':
    case 'working':
      return { ...task, status: 'working' as const };
    case 'completed':
      return { ...task, status: 'completed' as const, result: resultOf(read) };
    case 'failed':
      return { ...task, status: 'failed' as const, error: { code: INTERNAL_ERROR, message: DEADLINE_PASSED } };
  }
}
