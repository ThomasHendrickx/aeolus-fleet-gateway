import { createServer, type Server } from 'node:http';

import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../../src/adapters/prisma/client.js';
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
  describe('copies the initialised fleet', () => {
    let templateFleets: { id: string; name: string }[];
    let other: FleetServer | undefined;
    const clients: PrismaClient[] = [];

    function clientFor(server: FleetServer): PrismaClient {
      const client = createPrismaClient(server.databaseUrl);
      clients.push(client);
      return client;
    }

    beforeAll(async () => {
      const template = createPrismaClient(inject('fleetTemplateUrl'));
      try {
        templateFleets = await template.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM fleets`;
      } finally {
        await template.$disconnect();
      }
    });

    afterEach(async () => {
      await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
      await other?.stop();
      other = undefined;
    });

    it("holds the template's fleet", async () => {
      fleet = await startFleetServer(inject('postgresUrl'));

      expect(await clientFor(fleet).$queryRaw`SELECT id, name FROM fleets`).toEqual(templateFleets);
    }, 120_000);

    it('lets the person sign in on a copy', async () => {
      fleet = await startFleetServer(inject('postgresUrl'));

      expect(await signIn(fleet)).toBeTruthy();
    }, 120_000);

    it("leaves the other copy's fleet as the template's after a write", async () => {
      fleet = await startFleetServer(inject('postgresUrl'));
      other = await startFleetServer(inject('postgresUrl'));

      await clientFor(fleet).$executeRaw`UPDATE fleets SET name = 'changed'`;

      expect(await clientFor(other).$queryRaw`SELECT id, name FROM fleets`).toEqual(templateFleets);
    }, 120_000);
  });

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
