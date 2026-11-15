import { afterEach, expect, it, vi } from 'vitest';

import { removeStaleTestRuns } from './remove-stale-test-runs.js';

vi.mock('testcontainers', () => ({
  getContainerRuntimeClient: () => { throw new Error('Cannot verify process identities'); },
}));

afterEach(() => { vi.unstubAllGlobals(); });

it('leaves resources alone when process identities cannot be verified on macOS', async () => {
  const macProcess = Object.create(process);
  Object.defineProperty(macProcess, 'platform', { value: 'darwin' });
  vi.stubGlobal('process', macProcess);

  await expect(removeStaleTestRuns()).resolves.toBeUndefined();
});
