import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import { getContainerRuntimeClient } from 'testcontainers';

/**
 * The label every container a test run starts carries, its value the run. The
 * sweeper removes a run's containers by it, and CI checks by it that a run left
 * none behind.
 */
export const TEST_RUN_LABEL = 'aeolus-fleet.test-run';

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
export function startContainerSweeper(run: string): void {
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

/** The part of the container runtime the sweep uses. */
export interface SweepRuntime {
  listContainerIds(run: string): Promise<string[]>;
  removeContainer(id: string): Promise<void>;
}

/** How long the sweep waits between two lists, and how many lists it takes at most. */
export interface SweepTiming {
  readonly delayMs: number;
  readonly maxLists: number;
}

const DEFAULT_TIMING: SweepTiming = { delayMs: 1_000, maxLists: 10 };

/**
 * Removes every container of the run, running or not, with its anonymous
 * volumes. A container whose create request was still in flight when the run's
 * process died can appear after a list, so the sweep removes what it lists and
 * lists again after a short delay, until two lists in a row are empty. It stops
 * after the most lists the timing allows.
 */
export async function sweep(runtime: SweepRuntime, { run, timing = DEFAULT_TIMING }: { run: string; timing?: SweepTiming }): Promise<void> {
  let previous: string[] | undefined;
  for (let lists = 1; lists <= timing.maxLists; lists++) {
    const ids = await runtime.listContainerIds(run);
    if (previous?.length === 0 && ids.length === 0) {
      return;
    }
    // A container the run's teardown removes meanwhile answers not found: it is gone either way.
    await Promise.allSettled(ids.map((id) => runtime.removeContainer(id)));
    previous = ids;
    if (lists === timing.maxLists) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, timing.delayMs));
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
      .then((runtime) => sweep(runtime, { run }))
      .catch((error: unknown) => {
        console.error(`The sweeper of test run ${run} could not remove its containers:`, error);
        process.exitCode = 1;
      });
  });
  process.stdin.resume();
}
