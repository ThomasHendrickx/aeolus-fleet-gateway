import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { requireCoreVersion } from '../src/adapters/fleet/core-version.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

const run = promisify(execFile);

let fleet: FleetServer;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
});

afterAll(async () => {
  await fleet.stop();
});

/** What execFile rejects with when the process exits other than 0. */
const exitFailure = z.object({ code: z.number(), stderr: z.string() });

/** Runs `aeolus-gateway <args>` from its source, as the bin runs, until it exits. */
async function gateway(args: string[], environment: Record<string, string>): Promise<{ code: number; stderr: string }> {
  try {
    await run('npx', ['tsx', 'src/bin/aeolus-gateway.ts', ...args], { env: { ...process.env, ...environment }, timeout: 20_000 });
    return { code: 0, stderr: '' };
  } catch (error) {
    return exitFailure.parse(error);
  }
}

describe('the gateway against a real core (decision 0049)', () => {
  it('reads the version core says and starts', async () => {
    await expect(requireCoreVersion(fleet.url)).resolves.toBeUndefined();
  });

  it('exits 1 before it listens when the fleet does not answer, naming its version and the minimum', async () => {
    const { code, stderr } = await gateway(['start'], { FLEET_URL: 'http://127.0.0.1:9', PORT: '0' });
    expect(code).toBe(1);
    expect(stderr).toMatch(/^gateway 0\.0\.0 needs core 0\.27\.0 or later, and could not read the version of the fleet at http:\/\/127\.0\.0\.1:9: /);
  });
});
