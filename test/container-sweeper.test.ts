import { describe, expect, it } from 'vitest';

import { sweep, type SweepRuntime } from './support/container-sweeper.js';

const TIMING = { delayMs: 1, maxLists: 5 };

/** A container runtime that answers each list from a script, the last one again and again, and records what is removed. */
class FakeRuntime implements SweepRuntime {
  readonly removed: string[] = [];
  listed = 0;

  constructor(private readonly lists: string[][]) {}

  listContainerIds(): Promise<string[]> {
    return Promise.resolve(this.lists[Math.min(this.listed++, this.lists.length - 1)] ?? []);
  }

  removeContainer(id: string): Promise<void> {
    this.removed.push(id);
    return Promise.resolve();
  }
}

describe('the sweep of a test run', () => {
  it('removes a container whose create request finished after the first list', async () => {
    const runtime = new FakeRuntime([['early'], [], ['late'], [], []]);

    await sweep(runtime, { run: 'run', timing: TIMING });

    expect(runtime.removed).toEqual(['early', 'late']);
  });

  it('lists again before it ends when the first list is empty', async () => {
    const runtime = new FakeRuntime([[], ['late'], [], []]);

    await sweep(runtime, { run: 'run', timing: TIMING });

    expect(runtime.removed).toEqual(['late']);
  });

  it('ends after two empty lists in a row', async () => {
    const runtime = new FakeRuntime([['a'], [], []]);

    await sweep(runtime, { run: 'run', timing: TIMING });

    expect(runtime.listed).toBe(3);
  });

  it('stops after the most lists when containers keep appearing', async () => {
    const runtime = new FakeRuntime([['a']]);

    await sweep(runtime, { run: 'run', timing: TIMING });

    expect(runtime.listed).toBe(TIMING.maxLists);
  });

  it('goes on when a container is already gone', async () => {
    const runtime = new FakeRuntime([['a'], [], []]);
    runtime.removeContainer = () => Promise.reject(new Error('not found'));

    await expect(sweep(runtime, { run: 'run', timing: TIMING })).resolves.toBeUndefined();
  });

  it('does not wait after the last list it takes', async () => {
    const runtime = new FakeRuntime([['a']]);

    const outcome = await Promise.race([
      sweep(runtime, { run: 'run', timing: { delayMs: 60_000, maxLists: 1 } }).then(() => 'done'),
      new Promise((resolve) => setTimeout(() => { resolve('waiting'); }, 100)),
    ]);

    expect(outcome).toBe('done');
  });
});
