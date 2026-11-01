import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { createRoundWorker } from './round-worker.js';

// The gateway sends what the basket stores as sending (Bridge, section 9):
// a round at its start, as after a restart, again every interval while the
// fleet does not answer, and at once when a person presses Send.

/** A sleep that waits until woken or stopped, however long it was asked. */
const sleepUntilWoken = (_ms: number, signal: AbortSignal) => new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve(); }, { once: true }); });

describe("a worker of rounds, as the basket's sender is", () => {
  it('runs a round at its start, and at once when woken, one round at a time', async () => {
    let rounds = 0;
    let isRunning = false;
    let wasOverlapped = false;
    const worker = createRoundWorker({
      name: 'basket',
      round: async () => {
        wasOverlapped ||= isRunning;
        isRunning = true;
        rounds += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        isRunning = false;
        return { sent: 0, kept: 0, refused: 0 };
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

  it('goes on after a round that failed', async () => {
    let rounds = 0;
    const worker = createRoundWorker({
      name: 'basket',
      round: () => {
        rounds += 1;
        return rounds === 1 ? Promise.reject(new Error('database restarting')) : Promise.resolve({ sent: 1, kept: 0, refused: 0 });
      },
      sleep: (_ms, signal) => new Promise<void>((resolve) => { setTimeout(resolve, 5); signal.addEventListener('abort', () => { resolve(); }, { once: true }); }),
      intervalMs: 5,
      log: Fastify({ logger: false }).log,
    });

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await worker.stop();

    expect(rounds).toBeGreaterThan(1);
  });
});
