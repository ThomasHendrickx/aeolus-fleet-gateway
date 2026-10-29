import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { Sleep } from '../mcp-out/run-party.js';
import { createPushToWebhooks } from './push-to-webhooks.js';

const SUPPLIER = { fleetId: FLEET_ID, party: 'supplier' };
const POLL_MS = 2_000;

describe("an A2A client's pushes, round after round (slice 4)", () => {
  it('notices its tasks’ changes, then delivers the pushes due, each round, until stopped', async () => {
    const rounds: string[] = [];
    const stop = new AbortController();
    const slept: number[] = [];
    const sleep: Sleep = (ms) => {
      slept.push(ms);
      if (slept.length === 2) {
        stop.abort();
      }
      return Promise.resolve();
    };
    const push = createPushToWebhooks({
      notice: (caller) => {
        rounds.push(`notice ${caller.party}`);
        return Promise.resolve();
      },
      deliver: (caller) => {
        rounds.push(`deliver ${caller.party}`);
        return Promise.resolve();
      },
      sleep,
      pollMs: POLL_MS,
      failed: () => undefined,
    });

    await push({ caller: SUPPLIER, signal: stop.signal });

    expect({ rounds, slept }).toEqual({ rounds: ['notice supplier', 'deliver supplier', 'notice supplier', 'deliver supplier'], slept: [POLL_MS, POLL_MS] });
  });

  it('reports a failure of its own database and goes on the next round, never ending the loop', async () => {
    const stop = new AbortController();
    const failures: unknown[] = [];
    const delivered: number[] = [];
    let noticed = 0;
    const push = createPushToWebhooks({
      notice: () => {
        noticed += 1;
        return noticed === 1 ? Promise.reject(new Error('the database is gone')) : Promise.resolve();
      },
      deliver: () => {
        delivered.push(noticed);
        stop.abort();
        return Promise.resolve();
      },
      sleep: () => Promise.resolve(),
      pollMs: POLL_MS,
      failed: (error) => failures.push(error),
    });

    await push({ caller: SUPPLIER, signal: stop.signal });

    expect({ failures, delivered }).toEqual({ failures: [new Error('the database is gone')], delivered: [2] });
  });
});
