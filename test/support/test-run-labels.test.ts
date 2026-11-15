import { describe, expect, it } from 'vitest';

import { testRunLabels } from './test-run-labels.js';

describe('test run labels', () => {
  it('identifies a run safely when /proc is absent', () => {
    const labels = testRunLabels('a-run', () => {
      const error = new Error('No /proc');
      Object.assign(error, { code: 'ENOENT' });
      throw error;
    });

    expect(labels['aeolus-fleet.test-run']).toBe('a-run');
    expect(labels['aeolus-fleet.test-run-pid']).toBe(String(process.pid));
    expect(labels['aeolus-fleet.test-checkout']).toBe(process.cwd());
    expect(labels['aeolus-fleet.test-run-start']).toBe('unavailable');
  });
});
