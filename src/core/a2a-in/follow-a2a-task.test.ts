import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aCallReply, aClientCall, MESSAGE_ID, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { Clock } from '../shared/clock.js';
import { createFollowA2aTask } from './follow-a2a-task.js';
import { createSubscribeToA2aTask } from './subscribe-to-a2a-task.js';
import type { TaskView } from './task-view.js';

const SUPPLIER = { fleetId: FLEET_ID, party: 'supplier' };
const TASK_ID = 'task-1';
const SENT_AT = new Date('2026-10-23T12:00:00.000Z');
const POLL_MS = 250;
/** The call's deadline: four polls after it was sent. */
const DEADLINE_AT = new Date(SENT_AT.getTime() + 4 * POLL_MS);

let now: Date;
const clock: Clock = { now: () => now };
/** What happens in the fleet while the follow sleeps, one step per sleep. */
let steps: (() => Promise<void>)[];
let slept: number;
const sleep: Sleep = async (ms) => {
  slept += 1;
  now = new Date(now.getTime() + ms);
  await steps.shift()?.();
};

let calls: ReturnType<typeof memoryClientCalls>;

beforeEach(async () => {
  now = SENT_AT;
  steps = [];
  slept = 0;
  calls = memoryClientCalls();
  await calls.saveTask({ ...SUPPLIER, taskId: TASK_ID, contextId: 'ctx-1', createdAt: SENT_AT });
  await calls.save(aClientCall({ party: 'supplier', handle: TASK_ID, sentAt: SENT_AT, deadlineAt: DEADLINE_AT, task: { taskId: TASK_ID, message: '{}' } }));
});

const follow = () => createFollowA2aTask({ calls, clock, sleep, pollMs: POLL_MS });

/** Every view the follow yields, until it ends or after the most given. */
async function followed(signal = new AbortController().signal, most = 10): Promise<TaskView['status']['state'][]> {
  const states: TaskView['status']['state'][] = [];
  for await (const view of follow()({ caller: SUPPLIER, taskId: TASK_ID, signal })) {
    states.push(view.status.state);
    if (states.length >= most) {
      break;
    }
  }
  return states;
}

const aReply = (overrides: Parameters<typeof aCallReply>[0] = {}) => calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ receivedAt: now, ...overrides }));

describe('following an A2A task (slice 3, interop 3.4)', () => {
  it('yields the stored task first, then each change, and ends when it completes', async () => {
    steps = [
      () => calls.setDelivery({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, { state: 'acknowledged', since: now }),
      () => Promise.resolve(),
      () => aReply(),
    ];

    await expect(followed()).resolves.toEqual(['submitted', 'working', 'completed']);
  });

  it('yields a question as input required and goes on following', async () => {
    steps = [() => aReply({ contentType: 'application/vnd.aeolus.question+json', payload: '{}' }), () => aReply({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r02', messageId: 'msg_01m3tbfspe96yf1rnr4ank9r02' })];

    await expect(followed()).resolves.toEqual(['submitted', 'inputRequired', 'completed']);
  });

  it('ends when it fails at its deadline', async () => {
    await expect(followed()).resolves.toEqual(['submitted', 'failed']);
  });

  it('yields an ended task once and ends', async () => {
    await aReply();

    await expect(followed()).resolves.toEqual(['completed']);
    expect(slept).toBe(0);
  });

  it('ends once its signal is aborted, reading the task no more', async () => {
    const stop = new AbortController();
    steps = [
      () => {
        stop.abort();
        return Promise.resolve();
      },
      () => aReply(),
    ];

    await expect(followed(stop.signal)).resolves.toEqual(['submitted']);
    expect(slept).toBe(1);
  });
});

describe('SubscribeToTask follows one of the caller’s own tasks (slice 3)', () => {
  const subscribe = () => createSubscribeToA2aTask({ calls, clock, follow: follow() });

  it('refuses an unknown task, or another party’s, as not found', async () => {
    const [unknown, others] = [await subscribe()({ caller: SUPPLIER, taskId: 'task-9', signal: new AbortController().signal }), await subscribe()({ caller: { fleetId: FLEET_ID, party: 'claude' }, taskId: TASK_ID, signal: new AbortController().signal })];

    expect([unknown, others]).toMatchObject([
      { isOk: false, error: { kind: 'TASK_NOT_FOUND' } },
      { isOk: false, error: { kind: 'TASK_NOT_FOUND' } },
    ]);
  });

  it('refuses a task that ended', async () => {
    await aReply();

    await expect(subscribe()({ caller: SUPPLIER, taskId: TASK_ID, signal: new AbortController().signal })).resolves.toMatchObject({ isOk: false, error: { kind: 'TASK_TERMINAL' } });
  });

  it('follows a task still open from the task as it stands', async () => {
    steps = [() => aReply()];
    const subscribed = await subscribe()({ caller: SUPPLIER, taskId: TASK_ID, signal: new AbortController().signal });
    const states: string[] = [];
    if (subscribed.isOk) {
      for await (const view of subscribed.value) {
        states.push(view.status.state);
      }
    }

    expect(states).toEqual(['submitted', 'completed']);
  });
});
