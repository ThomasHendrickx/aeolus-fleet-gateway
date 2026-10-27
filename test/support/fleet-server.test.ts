import { afterEach, describe, expect, it } from 'vitest';

import { aFreePort } from './fleet-server.js';

const poolId = process.env.VITEST_POOL_ID;

afterEach(() => {
  if (poolId === undefined) {
    delete process.env.VITEST_POOL_ID;
    return;
  }
  process.env.VITEST_POOL_ID = poolId;
});

describe('aFreePort', () => {
  it('refuses a non-whole worker pool id', async () => {
    process.env.VITEST_POOL_ID = '1.5';

    await expect(aFreePort()).rejects.toThrow('expected int');
  });
});
