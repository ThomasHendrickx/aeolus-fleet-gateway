import { configDefaults, defineConfig } from 'vitest/config';

/** The integration files that start the gateway's bin, and with it its web app's development server. */
const GATEWAY_BIN_FILES = ['test/start.integration.test.ts', 'test/parties-pages.integration.test.ts'];

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
          exclude: [...configDefaults.exclude, ...GATEWAY_BIN_FILES],
          globalSetup: ['test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          // Files that start the gateway's bin, whose web app compiles web/ with one Next.js
          // development server per folder: they run one after another, never side by side.
          name: 'web-app:integration',
          include: GATEWAY_BIN_FILES,
          fileParallelism: false,
          globalSetup: ['test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
