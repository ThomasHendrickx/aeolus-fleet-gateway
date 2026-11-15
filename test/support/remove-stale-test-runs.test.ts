import { expect, it } from 'vitest';

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
