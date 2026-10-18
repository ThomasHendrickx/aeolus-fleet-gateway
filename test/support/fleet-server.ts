/**
 * A real fleet server for the integration tests: core from the
 * @aeolus-fleet/core devDependency, run by its own `aeolus-core` bin as an
 * installation runs it, on a database of its own in the shared Postgres.
 */
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { z } from 'zod';

const run = promisify(execFile);

/** How long a starting fleet server gets to answer its version. */
const START_TIMEOUT_MS = 60_000;
const START_POLL_MS = 200;

export interface FleetServer {
  /** Where ships reach the fleet, such as `http://127.0.0.1:41234`. */
  url: string;
  databaseUrl: string;
  stop(): Promise<void>;
}

const corePackage = z.object({ bin: z.object({ 'aeolus-core': z.string() }) });

/** Core's installed package; its exports name no package.json, so it is found from here. */
const CORE_PACKAGE = fileURLToPath(new URL('../../node_modules/@aeolus-fleet/core/', import.meta.url));

/** The path of core's `aeolus-core` bin in node_modules. */
function coreBin(): string {
  const bin = corePackage.parse(JSON.parse(readFileSync(join(CORE_PACKAGE, 'package.json'), 'utf8'))).bin['aeolus-core'];
  return join(CORE_PACKAGE, bin);
}

/** The URL of a new database on the server the admin URL points at; Prisma Migrate creates it. */
export function aNewDatabaseUrl(adminUrl: string, prefix: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${prefix}_${randomUUID().replaceAll('-', '')}`;
  return url.toString();
}

async function aFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('no free port'));
        }
      });
    });
  });
}

async function waitForVersion(url: string, exited: () => string | undefined): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const exit = exited();
    if (exit !== undefined) {
      throw new Error(`the fleet server exited before it answered: ${exit}`);
    }
    try {
      const response = await fetch(`${url}/api/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
  }
  throw new Error(`the fleet server at ${url} did not answer within ${String(START_TIMEOUT_MS)} ms`);
}

/** Migrates a new database and starts core on a free port, answering once it serves its version. */
export async function startFleetServer(adminUrl: string): Promise<FleetServer> {
  const databaseUrl = aNewDatabaseUrl(adminUrl, 'fleet');
  const bin = coreBin();
  await run(process.execPath, [bin, 'migrate'], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const port = await aFreePort();
  const url = `http://127.0.0.1:${String(port)}`;
  const child = spawn(process.execPath, [bin, 'start'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PUBLIC_URL: url, HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  let exit: string | undefined;
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.once('exit', (code) => {
    exit = `exit ${String(code)}: ${stderr}`;
  });
  await waitForVersion(url, () => exit);
  return {
    url,
    databaseUrl,
    stop: async () => {
      if (exit !== undefined) {
        return;
      }
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    },
  };
}
