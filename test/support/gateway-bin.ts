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

/** The groups started and not yet stopped, which the end of this process ends. */
const groups = new Set<number>();

function endGroups(): void {
  for (const pid of groups) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // The group is gone already.
    }
  }
  groups.clear();
}

/** Signals that end a test run: the process ends its groups, then ends as the signal would have ended it. */
const ENDING_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

let isEndingRegistered = false;

/** A group is in its own group so it outlives its parent: the parent's exit and ending signals must end it. */
function endGroupsWhenThisProcessEnds(): void {
  if (isEndingRegistered) {
    return;
  }
  isEndingRegistered = true;
  process.on('exit', endGroups);
  for (const signal of ENDING_SIGNALS) {
    process.once(signal, () => {
      endGroups();
      process.kill(process.pid, signal);
    });
  }
}

/** A process started in a group of its own, until the test stops it. */
export interface RunningGateway {
  /** The pid of the group's leader. */
  pid: number;
  /** Ends the process and every process it started (npx, tsx, its web app's server), and waits until it exited. */
  stop(): Promise<void>;
}

/** Starts a command (its file, then its arguments) in a process group of its own, so stopping it ends the whole group. */
export function startProcessGroup(command: string[], environment: Record<string, string>): RunningGateway {
  const [file = '', ...args] = command;
  const child = spawn(file, args, { env: { ...process.env, ...environment }, stdio: 'ignore', detached: true });
  endGroupsWhenThisProcessEnds();
  if (child.pid !== undefined) {
    groups.add(child.pid);
  }
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      if (child.pid !== undefined) {
        groups.delete(child.pid);
      }
      resolve();
    });
  });
  return {
    pid: child.pid ?? 0,
    stop: async () => {
      if (child.pid !== undefined && child.exitCode === null) {
        process.kill(-child.pid, 'SIGTERM');
      }
      await exited;
    },
  };
}

/**
 * Starts `aeolus-gateway start` in a process group of its own, so stopping it
 * ends the whole group: the next file's gateway then finds web/ free for its
 * own web app's development server.
 */
export function startGateway(environment: Record<string, string>): RunningGateway {
  return startProcessGroup(['npx', 'tsx', 'src/bin/aeolus-gateway.ts', 'start'], environment);
}
