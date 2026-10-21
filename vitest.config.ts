import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A poll's own default (1 second) holds only on an idle machine; a full
    // run shares its machine with Postgres and a fleet server.
    expect: { poll: { timeout: 10_000 } },
    projects: [
      {
        extends: true,
        test: {
          name: 'scripts:unit',
          include: ['scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'gateway:unit',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'web/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // The gateway on Postgres, against a real fleet server, both in the shared container.
          name: 'gateway:integration',
          include: ['test/**/*.integration.test.ts'],
          globalSetup: ['test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
