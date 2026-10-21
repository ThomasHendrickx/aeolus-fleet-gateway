import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

const run = promisify(execFile);

/** How long one `aeolus-gateway` command may take before the test counts it as hung. */
const COMMAND_TIMEOUT_MS = 30_000;

/** What execFile rejects with when the process exits other than 0. */
const exitFailure = z.object({ code: z.number(), stderr: z.string() });

/** Runs `aeolus-gateway <args>` from its source, as the bin runs, until it exits. */
export async function runGateway(args: string[], environment: Record<string, string>): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await run('npx', ['tsx', 'src/bin/aeolus-gateway.ts', ...args], { env: { ...process.env, ...environment }, timeout: COMMAND_TIMEOUT_MS });
    return { code: 0, stderr };
  } catch (error) {
    return exitFailure.parse(error);
  }
}

/** A gateway started from its source with `start`, as the bin runs, until the test stops it. */
export interface RunningGateway {
  /** Ends the gateway and every process it started (npx, tsx, its web app's server), and waits until it exited. */
  stop(): Promise<void>;
}

/**
 * Starts `aeolus-gateway start` in a process group of its own, so stopping it
 * ends the whole group: the next file's gateway then finds web/ free for its
 * own web app's development server.
 */
export function startGateway(environment: Record<string, string>): RunningGateway {
  const gateway = spawn('npx', ['tsx', 'src/bin/aeolus-gateway.ts', 'start'], { env: { ...process.env, ...environment }, stdio: 'ignore', detached: true });
  const exited = new Promise<void>((resolve) => {
    gateway.once('exit', () => {
      resolve();
    });
  });
  return {
    stop: async () => {
      if (gateway.pid !== undefined && gateway.exitCode === null) {
        process.kill(-gateway.pid, 'SIGTERM');
      }
      await exited;
    },
  };
}
