import { afterEach, expect, it, vi } from 'vitest';

import { removeStaleTestRuns } from './remove-stale-test-runs.js';

function fakeClient(labels: Record<string, string>) {
  const removedContainers: string[] = [];
  const removedVolumes: string[] = [];
  const getClient = () => Promise.resolve({
    container: {
      dockerode: {
        listContainers: () => Promise.resolve([{ Id: 'container', Labels: labels }]),
        listVolumes: () => Promise.resolve({ Volumes: [{ Name: 'volume', Labels: labels }] }),
        getContainer: (id: string) => ({ remove: () => { removedContainers.push(id); return Promise.resolve(); } }),
        getVolume: (name: string) => ({ remove: () => { removedVolumes.push(name); return Promise.resolve(); } }),
      },
    },
  });
  return { getClient, removedContainers, removedVolumes };
}

it('leaves a live run container and volume alone on macOS', async () => {
  const client = fakeClient({
    'aeolus-fleet.test-run-pid': String(process.pid),
    'aeolus-fleet.test-run-start': '0',
  });

  // The runtime client has many unrelated methods that this fake does not need.
  // @ts-expect-error The fake implements only the Docker operations used by the sweeper.
  await removeStaleTestRuns('darwin', client.getClient);

  expect(client.removedContainers).toEqual([]);
  expect(client.removedVolumes).toEqual([]);
});

it('a run labelled unavailable is never removed', async () => {
  const client = fakeClient({
    'aeolus-fleet.test-run-pid': String(process.pid),
    'aeolus-fleet.test-run-start': 'unavailable',
  });

  // @ts-expect-error The fake implements only the Docker operations used by the sweeper.
  await removeStaleTestRuns('linux', client.getClient);

  expect(client.removedContainers).toEqual([]);
  expect(client.removedVolumes).toEqual([]);
});

afterEach(() => {
  vi.useRealTimers();
});

const NOW = Date.parse('2026-11-16T12:00:00Z');
const HOUR_MS = 3_600_000;

function ageClient() {
  const removedContainers: string[] = [];
  const removedVolumes: string[] = [];
  const listFilters: unknown[] = [];
  const created = (hoursAgo: number) => Math.floor((NOW - hoursAgo * HOUR_MS) / 1000);
  const getClient = () => Promise.resolve({
    container: {
      dockerode: {
        listContainers: (options: { filters: unknown }) => {
          listFilters.push(options.filters);
          return Promise.resolve([
            { Id: 'old', Created: created(25), Labels: { 'aeolus-fleet.test-repository': 'aeolus-fleet-gateway' } },
            { Id: 'recent', Created: created(23), Labels: { 'aeolus-fleet.test-repository': 'aeolus-fleet-gateway' } },
          ]);
        },
        listVolumes: () => Promise.resolve({
          Volumes: [
            { Name: 'old-volume', CreatedAt: new Date(NOW - 25 * HOUR_MS).toISOString(), Labels: {} },
            { Name: 'recent-volume', CreatedAt: new Date(NOW - 23 * HOUR_MS).toISOString(), Labels: {} },
          ],
        }),
        getContainer: (id: string) => ({ remove: () => { removedContainers.push(id); return Promise.resolve(); } }),
        getVolume: (name: string) => ({ remove: () => { removedVolumes.push(name); return Promise.resolve(); } }),
      },
    },
  });
  return { getClient, removedContainers, removedVolumes, listFilters };
}

it('removes this repository containers and volumes older than 24 hours on any platform, by the repository label', async () => {
  vi.useFakeTimers({ now: NOW });
  const client = ageClient();

  // @ts-expect-error The fake implements only the Docker operations used by the sweeper.
  await removeStaleTestRuns('darwin', client.getClient);

  expect(client.listFilters).toContainEqual({ label: ['aeolus-fleet.test-repository=aeolus-fleet-gateway'] });
  expect(client.removedContainers).toEqual(['old']);
  expect(client.removedVolumes).toEqual(['old-volume']);
});
