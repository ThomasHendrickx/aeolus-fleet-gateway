import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { aFreePort, coreBin, startCore } from './fleet-server.js';

let stranger: Server | undefined;

afterEach(async () => {
  const closing = stranger;
  stranger = undefined;
  if (closing !== undefined) {
    await new Promise((resolve) => {
      closing.close(resolve);
    });
  }
});

/** Another process that took the port core was to listen on, and answers a version as any server does. */
async function aStrangerOn(port: number): Promise<void> {
  const listening = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end('{}');
  });
  stranger = listening;
  await new Promise((resolve) => {
    listening.listen(port, '127.0.0.1', () => {
      resolve(undefined);
    });
  });
}

describe('startCore', () => {
  it('does not answer for a port another process listens on', async () => {
    const port = await aFreePort();
    await aStrangerOn(port);

    // Core cannot reach this database, so it never listens: only the stranger answers.
    await expect(startCore(coreBin(), { databaseUrl: 'postgresql://nobody@127.0.0.1:1/none', port })).rejects.toThrow('exited before it listened');
  }, 90_000);
});
