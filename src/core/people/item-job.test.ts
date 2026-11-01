import { describe, expect, it } from 'vitest';

import { isCounted, jobOf } from './item-job.js';

// Bridge tells an item's job by its content type (docs/design/bridge, CC10).

describe("an item's job, by its content type (Bridge, CC10)", () => {
  it.each([
    ['application/vnd.aeolus.question+json', 'decide'],
    ['application/vnd.aeolus.question-replacement+json', 'decide'],
    ['application/vnd.aeolus.step+json', 'do'],
    ['application/vnd.aeolus.alert+json', 'stay-aware'],
    ['application/vnd.aeolus.notice+json', 'stay-aware'],
    ['text/plain', 'everything-else'],
    ['application/vnd.aeolus.answer+json', 'everything-else'],
    ['application/vnd.aeolus.question-withdrawal+json', 'everything-else'],
  ])('names %s as the job %s', (contentType, job) => {
    expect(jobOf(contentType)).toBe(job);
  });

  it('compares content types without case and without parameters', () => {
    expect(jobOf('Application/Vnd.Aeolus.Step+JSON; charset=utf-8')).toBe('do');
  });

  it('counts decide and do in what waits, and neither stay aware nor everything else', () => {
    expect((['decide', 'do', 'stay-aware', 'everything-else'] as const).map(isCounted)).toEqual([true, true, false, false]);
  });
});
