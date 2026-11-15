import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

import { getContainerRuntimeClient } from 'testcontainers';
import { describe, expect, inject, it, onTestFinished } from 'vitest';

import { POSTGRES_IMAGE } from './support/container-images.js';
import { TEST_RUN_LABEL } from './support/container-sweeper.js';
import { TestPostgres } from './support/postgres-container.js';
import { startRunProcess } from './support/test-run-process.js';

const RUN_PROCESS = new URL('./support/test-run-process.ts', import.meta.url).href;

/** Waits long enough for a Postgres to start on a loaded machine, and for the sweeper to remove it. */
const CONTAINER_TIMEOUT = 120_000;

async function dockerode() {
  return (await getContainerRuntimeClient()).container.dockerode;
}

async function containersOf(run: string): Promise<string[]> {
  const containers = await (await dockerode()).listContainers({ all: true, filters: { label: [`${TEST_RUN_LABEL}=${run}`] } });
  return containers.map((container) => container.Id);
}

async function volumesOf(containerId: string): Promise<string[]> {
  const inspected = await (await dockerode()).getContainer(containerId).inspect();
  return inspected.Mounts.flatMap((mount) => (mount.Type === 'volume' && mount.Name ? [mount.Name] : []));
}

async function existingVolumes(names: readonly string[]): Promise<string[]> {
  const docker = await dockerode();
  const found = await Promise.all(
    names.map(async (name) => {
      try {
        await docker.getVolume(name).inspect();
        return [name];
      } catch {
        return [];
      }
    }),
  );
  return found.flat();
}

/** Kills a process by its pid, if it still runs. */
function killIfRunning(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // It ended already.
  }
}

/**
 * A test's process, as the Vitest worker that runs a test: it starts the
 * process of a test run of its own and answers that process's pid.
 */
async function startTestProcess(run: string): Promise<{ testPid: number | undefined; runPid: number }> {
  const script = `import { startRunProcess } from ${JSON.stringify(RUN_PROCESS)}; const runProcess = await startRunProcess(process.argv[1]); console.log(runProcess.pid); setInterval(() => {}, 60_000);`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, run], { stdio: ['ignore', 'pipe', 'inherit'] });
  for await (const line of createInterface({ input: child.stdout })) {
    return { testPid: child.pid, runPid: Number(line) };
  }
  throw new Error(`The test process of test run ${run} ended before it started the run's process`);
}

// Rootless Podman often runs no reaper, so a run's own teardown and its sweeper are all that remove its containers (#1581).
describe('the containers of a test run', () => {
  it(
    'are removed with their volumes when the run is killed before its teardown',
    async () => {
      const run = `test-${randomUUID()}`;
      const runProcess = await startRunProcess(run);
      onTestFinished(() => {
        killIfRunning(runProcess.pid);
      });
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      runProcess.kill('SIGKILL');

      await expect.poll(() => containersOf(run), { timeout: 60_000, interval: 500 }).toEqual([]);
      await expect.poll(() => existingVolumes(volumes), { timeout: 30_000, interval: 500 }).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it(
    'are removed with their volumes when the test that started the run is killed',
    async () => {
      const run = `test-${randomUUID()}`;
      const { testPid, runPid } = await startTestProcess(run);
      onTestFinished(() => {
        killIfRunning(testPid);
        killIfRunning(runPid);
      });
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      killIfRunning(testPid);

      await expect.poll(() => containersOf(run), { timeout: 60_000, interval: 500 }).toEqual([]);
      await expect.poll(() => existingVolumes(volumes), { timeout: 30_000, interval: 500 }).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it(
    'leave no Postgres volume behind when a teardown stops them',
    async () => {
      const run = `test-${randomUUID()}`;
      const runProcess = await startRunProcess(run);
      onTestFinished(() => {
        killIfRunning(runProcess.pid);
      });
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      await postgres.stop();

      expect(await containersOf(run)).toEqual([]);
      expect(await existingVolumes(volumes)).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it('include the shared Postgres the global setup starts, so its sweeper removes it', async () => {
    const containers = await (await dockerode()).listContainers({ filters: { label: [`${TEST_RUN_LABEL}=${inject('testRun')}`] } });

    expect(containers.map((container) => container.Image)).toContain(POSTGRES_IMAGE);
  });
});
