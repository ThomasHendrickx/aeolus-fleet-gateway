/**
 * Teardown that survives a failed setup: a resource not started yet is
 * undefined, and every other one is still stopped.
 */

/** Waits for every start to settle, so none finishes after teardown ran, then fails with the first failure. */
export async function settleAll(starts: Promise<unknown>[]): Promise<void> {
  const settled = await Promise.allSettled(starts);
  for (const each of settled) {
    if (each.status === 'rejected') {
      throw each.reason;
    }
  }
}

/** Runs every stop, one failing not keeping the others from running, then fails with the first failure. */
export async function stopAll(stops: (() => Promise<unknown> | undefined)[]): Promise<void> {
  const settled = await Promise.allSettled(stops.map(async (stop) => stop()));
  for (const each of settled) {
    if (each.status === 'rejected') {
      throw each.reason;
    }
  }
}
