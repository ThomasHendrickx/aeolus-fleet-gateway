import { readFileSync } from 'node:fs';

import { getContainerRuntimeClient } from 'testcontainers';

import { TEST_REPOSITORY, testRunLabels } from './test-run-labels.ts';

/** A test container of this repository older than this is a leak: no run lasts that long. */
const MAX_AGE_MS = 24 * 3_600_000;

/** The runtime answers a volume's creation time, which the types of its list leave out. */
function isOlderThan(volume: object, cutoff: number): boolean {
  return 'CreatedAt' in volume && typeof volume.CreatedAt === 'string' && Date.parse(volume.CreatedAt) < cutoff;
}

/** Removes this repository's test containers and volumes older than 24 hours, a killed run's too, on any platform. */
async function removeOldTestContainers(getClient: typeof getContainerRuntimeClient): Promise<void> {
  const { dockerode } = (await getClient()).container;
  const filters = { label: [`aeolus-fleet.test-repository=${TEST_REPOSITORY}`] };
  const cutoff = Date.now() - MAX_AGE_MS;
  const containers = await dockerode.listContainers({ all: true, filters });
  await Promise.allSettled(
    containers
      .filter((container) => container.Created * 1000 < cutoff)
      .map((container) => dockerode.getContainer(container.Id).remove({ force: true, v: true })),
  );
  const volumes = await dockerode.listVolumes({ filters });
  await Promise.allSettled(
    volumes.Volumes.filter((volume) => isOlderThan(volume, cutoff)).map((volume) =>
      dockerode.getVolume(volume.Name).remove(),
    ),
  );
}

/** Removes only resources whose checkout and dead process can be identified. */
export async function removeStaleTestRuns(platform: NodeJS.Platform = process.platform, getClient: typeof getContainerRuntimeClient = getContainerRuntimeClient): Promise<void> {
  await removeOldTestContainers(getClient);
  // Process identities from /proc cannot be verified on other platforms.
  if (platform !== 'linux') return;
  const { dockerode } = (await getClient()).container;
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
