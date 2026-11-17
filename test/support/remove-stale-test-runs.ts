import { readFileSync } from 'node:fs';

import { getContainerRuntimeClient } from 'testcontainers';

import { TEST_REPOSITORY, testRunLabels } from './test-run-labels.ts';

/** A test container of this repository older than this is a leak: no run lasts that long. */
const MAX_AGE_MS = 24 * 3_600_000;

/** The runtime answers a volume's creation time, which the types of its list leave out. */
function isOlderThan(volume: object, cutoff: number): boolean {
  return 'CreatedAt' in volume && typeof volume.CreatedAt === 'string' && Date.parse(volume.CreatedAt) < cutoff;
}

/** Whether the run that owns a resource is alive: undefined when the labels or the platform cannot tell. */
function isRunAlive(labels: Record<string, string> | undefined, platform: NodeJS.Platform): boolean | undefined {
  const pid = labels?.['aeolus-fleet.test-run-pid'];
  const start = labels?.['aeolus-fleet.test-run-start'];
  if (!pid || !/^[1-9][0-9]*$/.test(pid) || !start) return undefined;
  try {
    process.kill(Number(pid), 0);
  } catch (error: unknown) {
    // EPERM means the process exists but belongs to another user.
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return true;
    return error instanceof Error && 'code' in error && error.code === 'ESRCH' ? false : undefined;
  }
  if (platform !== 'linux' || !/^\d+$/.test(start)) return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const actual = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    return actual === undefined ? undefined : actual === start;
  } catch {
    return undefined;
  }
}

/** Removes this repository's test containers and volumes older than 24 hours on any platform, never a live run's. Age alone decides only when liveness cannot be checked. */
async function removeOldTestContainers(platform: NodeJS.Platform, getClient: typeof getContainerRuntimeClient): Promise<void> {
  const { dockerode } = (await getClient()).container;
  const filters = { label: [`aeolus-fleet.test-repository=${TEST_REPOSITORY}`] };
  const cutoff = Date.now() - MAX_AGE_MS;
  const containers = await dockerode.listContainers({ all: true, filters });
  await Promise.allSettled(
    containers
      .filter((container) => container.Created * 1000 < cutoff && isRunAlive(container.Labels, platform) !== true)
      .map((container) => dockerode.getContainer(container.Id).remove({ force: true, v: true })),
  );
  const volumes = await dockerode.listVolumes({ filters });
  await Promise.allSettled(
    volumes.Volumes.filter((volume) => isOlderThan(volume, cutoff) && isRunAlive(volume.Labels, platform) !== true).map((volume) =>
      dockerode.getVolume(volume.Name).remove(),
    ),
  );
}

/** Removes only resources whose checkout and dead process can be identified. */
export async function removeStaleTestRuns(platform: NodeJS.Platform = process.platform, getClient: typeof getContainerRuntimeClient = getContainerRuntimeClient): Promise<void> {
  await removeOldTestContainers(platform, getClient);
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
