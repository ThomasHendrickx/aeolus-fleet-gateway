import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import { getContainerRuntimeClient } from 'testcontainers';

import { sweep, type SweepRuntime } from './sweep.ts';
import { removeStaleTestRuns } from './remove-stale-test-runs.ts';
import { TEST_RUN_LABEL } from './test-run-label.ts';

/**
 * Starts the sweeper of a test run: a process of its own that removes the
 * run's containers with their volumes once the run's process ends, however it
 * ends. A run's teardown removes them too, but an interrupted or killed run
 * never reaches it, and rootless Podman often runs no Testcontainers reaper
 * (#1581). The sweeper learns the run ended when the pipe from the run's
 * process closes, which the operating system does for a killed process too. It
 * runs in a process group of its own, so the Ctrl-C that interrupts the run
 * does not stop it, and it keeps the run's process from exiting by nothing.
 * The file is the sweeper: this function starts it again as a program.
 */
export async function startContainerSweeper(run: string): Promise<void> {
  await removeStaleTestRuns();
  const sweeper = spawn(process.execPath, [fileURLToPath(import.meta.url), run], {
    detached: true,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  sweeper.unref();
  // The pipe is a socket: unreferenced, it keeps the run's process from exiting by nothing either.
  if (sweeper.stdin instanceof Socket) {
    sweeper.stdin.unref();
  }
}

async function dockerRuntime(): Promise<SweepRuntime> {
  const { dockerode } = (await getContainerRuntimeClient()).container;
  return {
    async listContainerIds(run) {
      const containers = await dockerode.listContainers({
        all: true,
        filters: { label: [`${TEST_RUN_LABEL}=${run}`] },
      });
      return containers.map((container) => container.Id);
    },
    async removeContainer(id) {
      await dockerode.getContainer(id).remove({ force: true, v: true });
    },
  };
}

if (import.meta.main) {
  const run = process.argv[2];
  if (!run) {
    console.error('Usage: node container-sweeper.ts <test run>');
    process.exit(2);
  }
  process.stdin.on('end', () => {
    dockerRuntime()
      .then(async (runtime) => {
        await sweep(runtime, { run });
        const { dockerode } = (await getContainerRuntimeClient()).container;
        const volumes = await dockerode.listVolumes({ filters: { label: [`${TEST_RUN_LABEL}=${run}`] } });
        await Promise.allSettled(volumes.Volumes.map((volume) => dockerode.getVolume(volume.Name).remove()));
      })
      .catch((error: unknown) => {
        console.error(`The sweeper of test run ${run} could not remove its containers:`, error);
        process.exitCode = 1;
      });
  });
  process.stdin.resume();
}
