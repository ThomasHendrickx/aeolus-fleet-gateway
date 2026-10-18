import { execFile } from 'node:child_process';
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
