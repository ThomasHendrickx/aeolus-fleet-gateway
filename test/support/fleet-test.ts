import { it } from 'vitest';

/** Lets a test explicitly retain the fresh fleet setup when it exercises persistence or concurrency. */
export const fleetTest = it.extend<{ isFresh: boolean }>({ isFresh: false });
export const freshFleetTest = fleetTest.extend({ isFresh: true });
