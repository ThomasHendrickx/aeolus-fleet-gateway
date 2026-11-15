import { describe, expect, it } from 'vitest';

import { ContainerCleanupError, stopContainer } from './support/stop-container.js';

const PID_TIMEOUT = new Error('(HTTP code 500) server error - given PID did not die within timeout');

describe('stopping a test container', () => {
  it('tries again when the runtime says the process did not die in time, so a passing run exits 0', async () => {
    let calls = 0;
    const stop = (): Promise<void> => {
      calls += 1;
      return calls < 3 ? Promise.reject(PID_TIMEOUT) : Promise.resolve();
    };

    await expect(stopContainer({ name: 'Postgres', stop, delayMs: 0 })).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  it('reports a container that never stops as cleanup, not as a failing test', async () => {
    let calls = 0;
    const stop = (): Promise<void> => {
      calls += 1;
      return Promise.reject(PID_TIMEOUT);
    };

    const failure = await stopContainer({ name: 'Postgres', stop, attempts: 3, delayMs: 0 }).catch((e: unknown) => e);

    if (!(failure instanceof ContainerCleanupError)) {
      throw new Error('expected a ContainerCleanupError', { cause: failure });
    }
    expect(failure.message).toMatch(/cleanup failed, not a test failure: Postgres/);
    expect(failure.cause).toBe(PID_TIMEOUT);
    expect(calls).toBe(3);
  });
});
