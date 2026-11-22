import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { signIn } from './argo.js';
import { aFreePort, startFleetServer, type FleetServer } from './fleet-server.js';

let stranger: Server | undefined;
let fleet: FleetServer | undefined;

afterEach(async () => {
  await fleet?.stop();
  fleet = undefined;
  const closing = stranger;
  stranger = undefined;
  if (closing !== undefined) {
    await new Promise((resolve) => {
      closing.close(resolve);
    });
  }
});

/** Another process that took the port the setup chose first. */
async function aStrangerOn(port: number): Promise<void> {
  const listening = createServer((_request, response) => {
    response.end('{}');
  });
  stranger = listening;
  await new Promise((resolve) => {
    listening.listen(port, '127.0.0.1', () => {
      resolve(undefined);
    });
  });
}

describe('startFleetServer', () => {
  it('copies the initialised fleet into isolated databases', async () => {
    fleet = await startFleetServer(inject('postgresUrl'));
    const other = await startFleetServer(inject('postgresUrl'));
    const first = createPrismaClient(fleet.databaseUrl);
    const second = createPrismaClient(other.databaseUrl);
    try {
      expect(await signIn(fleet)).toBeTruthy();
      expect(await signIn(other)).toBeTruthy();
      const firstFleet = await first.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM fleets`;
      const secondFleet = await second.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM fleets`;
      expect(firstFleet).toEqual(secondFleet);
      await first.$executeRaw`UPDATE fleets SET name = 'changed'`;
      expect(await second.$queryRaw<{ name: string }[]>`SELECT name FROM fleets`).toEqual([{ name: 'test fleet' }]);
    } finally {
      await Promise.all([first.$disconnect(), second.$disconnect(), other.stop()]);
    }
  }, 120_000);

  it('starts a separately initialised fleet when fresh setup is requested', async () => {
    fleet = await startFleetServer(inject('postgresUrl'));
    const fresh = await startFleetServer(inject('postgresUrl'), { isFresh: true });
    const first = createPrismaClient(fleet.databaseUrl);
    const second = createPrismaClient(fresh.databaseUrl);
    try {
      const copied = await first.$queryRaw<{ id: string }[]>`SELECT id FROM fleets`;
      const independent = await second.$queryRaw<{ id: string }[]>`SELECT id FROM fleets`;
      expect(copied).not.toEqual(independent);
    } finally {
      await Promise.all([first.$disconnect(), second.$disconnect(), fresh.stop()]);
    }
  }, 120_000);

  it('starts on a new port when the first one is taken', async () => {
    const taken = await aFreePort();
    await aStrangerOn(taken);
    const free = await aFreePort();
    const ports = [taken, free];

    fleet = await startFleetServer(inject('postgresUrl'), { aPort: () => Promise.resolve(ports.shift() ?? free) });

    expect(fleet.url).toBe(`http://127.0.0.1:${String(free)}`);
    expect((await fetch(`${fleet.url}/api/version`)).ok).toBe(true);
  }, 120_000);

  it('gives up after a bounded number of taken ports', async () => {
    const taken = await aFreePort();
    await aStrangerOn(taken);
    let asked = 0;

    await expect(
      startFleetServer(inject('postgresUrl'), {
        aPort: () => {
          asked += 1;
          return Promise.resolve(taken);
        },
      }),
    ).rejects.toThrow('exited before it listened');
    expect(asked).toBe(3);
  }, 180_000);
});
