import { expect, it } from 'vitest';

import { removeStaleTestRuns } from './remove-stale-test-runs.js';

it('leaves resources alone when process identities cannot be verified on macOS', async () => {
  await expect(removeStaleTestRuns('darwin', () => { throw new Error('Cannot verify process identities'); })).resolves.toBeUndefined();
});
