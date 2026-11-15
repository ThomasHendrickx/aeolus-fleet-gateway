import { describe, expect, it, vi } from 'vitest';

import { testRunLabels } from './test-run-labels.js';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    readFileSync: () => {
      const error = new Error('No /proc');
      Object.assign(error, { code: 'ENOENT' });
      throw error;
    },
  };
});

describe('test run labels', () => {
  it('identifies a run safely when /proc is absent', () => {
    const labels = testRunLabels('a-run');

    expect(labels['aeolus-fleet.test-run']).toBe('a-run');
    expect(labels['aeolus-fleet.test-run-pid']).toBe(String(process.pid));
    expect(labels['aeolus-fleet.test-checkout']).toBe(process.cwd());
    expect(labels['aeolus-fleet.test-run-start']).toBe('unavailable');
  });
});
