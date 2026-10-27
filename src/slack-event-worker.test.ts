import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { createSlackEventWorker } from './slack-event-worker.js';

// The gateway sends the kept Slack events every round, and at once when one
// is kept (gateway scopes 9.4), one round at a time.

/** A sleep that waits until woken or stopped, however long it was asked. */
const sleepUntilWoken = (_ms: number, signal: AbortSignal) => new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve(); }, { once: true }); });

describe("the gateway's sends from Slack into the fleet", () => {
  it('sends a round at once when woken, not at the next interval, one round at a time', async () => {
    let rounds = 0;
    let isRunning = false;
    let wasOverlapped = false;
    const worker = createSlackEventWorker({
      send: async () => {
        wasOverlapped ||= isRunning;
        isRunning = true;
        rounds += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        isRunning = false;
      },
      sleep: sleepUntilWoken,
      intervalMs: 60_000,
      log: Fastify().log,
    });

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    worker.wake();
    worker.wake();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await worker.stop();

    expect({ rounds, wasOverlapped }).toEqual({ rounds: 2, wasOverlapped: false });
  });
});
