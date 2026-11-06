import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/** Whether a process with this pid still exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Starts the test-run stand-in, and answers it with the pid of the process it started and a way to wait for its end. */
async function startRun(mode: 'exit' | 'wait'): Promise<{ run: ReturnType<typeof spawn>; childPid: number; ended: Promise<void> }> {
  const run = spawn(process.execPath, ['--import', 'tsx', 'test/support/gateway-bin-runner.ts', mode], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ended = new Promise<void>((resolve) => {
    run.once('exit', () => {
      resolve();
    });
  });
  const childPid = await new Promise<number>((resolve) => {
    run.stdout?.once('data', (chunk: Buffer) => {
      resolve(Number(chunk.toString().trim()));
    });
  });
  return { run, childPid, ended };
}

describe('a process a test run starts in its own group', () => {
  it('is gone when the run exits by itself', async () => {
    const { childPid, ended } = await startRun('exit');
    await ended;

    await expect.poll(() => isAlive(childPid)).toBe(false);
  });

  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'] as const)('is gone when the run is interrupted by %s', async (signal) => {
    const { run, childPid, ended } = await startRun('wait');
    expect(isAlive(childPid)).toBe(true);

    run.kill(signal);
    await ended;

    await expect.poll(() => isAlive(childPid)).toBe(false);
  });
});
