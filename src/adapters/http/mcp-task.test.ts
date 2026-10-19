import { isCreateTaskResultV2, isDetailedTaskV2 } from '@modelcontextprotocol/ext-tasks/core/v2';
import { describe, expect, it } from 'vitest';

import { createdTaskOf, taskOf } from './mcp-task.js';

// An outside client's call as an MCP task (Tasks extension, 2026-07-28): the
// task id is the call's handle, and its status the call's state (interop 3.4).

const SENT = { handle: 'h-1', createdAt: new Date('2026-10-19T12:00:00.000Z') };
const RESULT = { content: [{ type: 'text' as const, text: 'Two deals.' }] };
const resultOf = () => RESULT;

describe('an outside MCP client is answered a task for a call not answered within its wait', () => {
  it('answers the task created, working, by the handle, kept as long as the call', () => {
    const created = createdTaskOf({ ...SENT, updatedAt: SENT.createdAt, state: 'submitted' });

    expect(created).toEqual({
      resultType: 'task',
      taskId: 'h-1',
      status: 'working',
      createdAt: '2026-10-19T12:00:00.000Z',
      lastUpdatedAt: '2026-10-19T12:00:00.000Z',
      ttlMs: null,
      pollIntervalMs: 2000,
    });
    expect(isCreateTaskResultV2(created)).toBe(true);
  });
});

describe('tasks/get reads the call as its task', () => {
  it.each([
    { what: 'a submitted call is working', state: 'submitted' as const },
    { what: 'a working call is working', state: 'working' as const },
  ])('$what', ({ state }) => {
    const task = taskOf({ ...SENT, updatedAt: new Date('2026-10-19T12:01:00.000Z'), state }, resultOf);

    expect(task).toEqual({ resultType: 'complete', taskId: 'h-1', status: 'working', createdAt: '2026-10-19T12:00:00.000Z', lastUpdatedAt: '2026-10-19T12:01:00.000Z', ttlMs: null, pollIntervalMs: 2000 });
    expect(isDetailedTaskV2(task)).toBe(true);
  });

  it("is completed with the call's answer as the tool's result", () => {
    const task = taskOf({ ...SENT, updatedAt: new Date('2026-10-19T12:03:00.000Z'), state: 'completed', answer: { contentType: 'text/plain', payload: 'Two deals.' } }, resultOf);

    expect(task).toMatchObject({ status: 'completed', lastUpdatedAt: '2026-10-19T12:03:00.000Z', result: RESULT });
    expect(isDetailedTaskV2(task)).toBe(true);
  });

  it('is failed with an error saying the call may have run, once its deadline passed', () => {
    const task = taskOf({ ...SENT, updatedAt: new Date('2026-10-19T12:10:00.000Z'), state: 'failed' }, resultOf);

    expect(task).toMatchObject({ status: 'failed', lastUpdatedAt: '2026-10-19T12:10:00.000Z', error: { code: -32603, message: 'The call got no answer before its deadline. It may have run all the same.' } });
    expect(isDetailedTaskV2(task)).toBe(true);
  });
});
