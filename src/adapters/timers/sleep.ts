import { setTimeout as wait } from 'node:timers/promises';

import type { Sleep } from '../../core/mcp-out/run-party.js';

/** Waits the given time, or less once the signal aborts. */
export const sleep: Sleep = async (ms, signal) => {
  try {
    await wait(ms, undefined, { signal });
  } catch {
    // Aborted: the wait ends early, as the port says.
  }
};
