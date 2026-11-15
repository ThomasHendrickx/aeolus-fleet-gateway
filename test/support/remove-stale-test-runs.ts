import { readFileSync } from 'node:fs';

import { getContainerRuntimeClient } from 'testcontainers';

import { testRunLabels } from './test-run-labels.ts';

/** Removes only resources whose checkout and dead process can be identified. */
export async function removeStaleTestRuns(): Promise<void> {
  const { dockerode } = (await getContainerRuntimeClient()).container;
  const checkout = testRunLabels('current')['aeolus-fleet.test-checkout'];
  const filters = { label: [`aeolus-fleet.test-checkout=${checkout}`, 'aeolus-fleet.test-run'] };
  const isStale = (labels: Record<string, string> | undefined): boolean => {
    const pid = labels?.['aeolus-fleet.test-run-pid'];
    const start = labels?.['aeolus-fleet.test-run-start'];
    if (!pid || !/^[1-9][0-9]*$/.test(pid) || !start || !/^\d+$/.test(start)) return false;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const actual = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      return actual !== undefined && actual !== start;
    } catch (error: unknown) {
      return error instanceof Error && 'code' in error && error.code === 'ENOENT';
    }
  };
  const containers = await dockerode.listContainers({ all: true, filters });
  for (const container of containers) {
    if (isStale(container.Labels)) await dockerode.getContainer(container.Id).remove({ force: true, v: true });
  }
  const volumes = await dockerode.listVolumes({ filters });
  for (const volume of volumes.Volumes) {
    if (isStale(volume.Labels)) await dockerode.getVolume(volume.Name).remove();
  }
}
