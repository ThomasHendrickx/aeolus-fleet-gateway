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

/** argo's console sign-in on every test fleet. */
export const OPERATOR = { email: 'argo@example.com', password: 'correct horse battery staple' };

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

/** Each test worker takes ports from a block of its own, below the range the system hands out to port 0. */
const PORTS_PER_WORKER = 400;
const FIRST_PORT = 10_000;
const WORKER_BLOCKS = 50;
let nextPort = 0;

/**
 * A port nothing listens on, that no other test worker hands out: a port from port 0
 * is free again once closed, so two files starting servers side by side could be given
 * the same one, and a server then answered for another's.
 */
export async function aFreePort(): Promise<number> {
  const block = (Number(process.env.VITEST_POOL_ID ?? process.pid) % WORKER_BLOCKS) * PORTS_PER_WORKER;
  for (let tries = 0; tries < PORTS_PER_WORKER; tries += 1) {
    const port = FIRST_PORT + block + (nextPort % PORTS_PER_WORKER);
    nextPort += 1;
    if (await isFree(port)) {
      return port;
    }
  }
  throw new Error('no free port');
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
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

/** Creates the fleet and argo as an operator does once: the one-use sign-in ticket its printed link carries. */
async function initialiseFleet(bin: string, environment: Record<string, string>): Promise<string> {
  const child = spawn(process.execPath, [bin, 'fleet:init', '--name', 'test fleet'], { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve) => child.once('close', resolve));
  const ticket = /[?&]ticket=([^\s&]+)/.exec(stdout)?.[1];
  if (code !== 0 || ticket === undefined) {
    throw new Error(`aeolus-core fleet:init failed: ${stderr}`);
  }
  return decodeURIComponent(ticket);
}

/** argo signs in with the init link's ticket and sets its email and password in Settings, so a test signs in with them. */
async function setOperatorLogin(url: string, ticket: string): Promise<void> {
  const headers = { 'content-type': 'application/json', origin: url };
  const redeemed = await fetch(`${url}/trpc/console.redeemSignInTicket`, { method: 'POST', headers, body: JSON.stringify({ ticket }) });
  const cookie = redeemed.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='))?.split(';')[0];
  if (cookie === undefined) {
    throw new Error(`argo could not sign in with the init link: ${await redeemed.text()}`);
  }
  const set = await fetch(`${url}/trpc/console.setLogin`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }) });
  if (!set.ok) {
    throw new Error(`argo could not set its email and password: ${await set.text()}`);
  }
}

/** Migrates a new database, creates its fleet and argo, and starts core on a free port, answering once it serves its version. */
export async function startFleetServer(adminUrl: string): Promise<FleetServer> {
  const databaseUrl = aNewDatabaseUrl(adminUrl, 'fleet');
  const bin = coreBin();
  await run(process.execPath, [bin, 'migrate'], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const port = await aFreePort();
  const url = `http://127.0.0.1:${String(port)}`;
  const ticket = await initialiseFleet(bin, { DATABASE_URL: databaseUrl, PUBLIC_URL: url });
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
  await setOperatorLogin(url, ticket);
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
