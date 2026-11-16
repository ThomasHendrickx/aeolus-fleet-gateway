import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, inject, it } from 'vitest';

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
