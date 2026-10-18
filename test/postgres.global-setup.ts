import type { TestProject } from 'vitest/node';

import { POSTGRES_IMAGE, REAPER_IMAGE } from './support/container-images.js';
import { TestPostgres } from './support/postgres-container.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin URL of the Postgres container shared by the integration tests. */
    postgresUrl: string;
  }
}

/**
 * Starts one Postgres for the integration project. Each fleet server and
 * gateway database a test asks for is a database of its own in it, so files
 * stay isolated. Testcontainers reads the reaper image from the environment
 * when it starts the first container; a reaper image set from outside wins.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  process.env.RYUK_CONTAINER_IMAGE ??= REAPER_IMAGE;
  const container = await new TestPostgres(POSTGRES_IMAGE).start();
  project.provide('postgresUrl', container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
