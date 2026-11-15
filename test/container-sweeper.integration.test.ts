import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

import { getContainerRuntimeClient } from 'testcontainers';
import { describe, expect, inject, it, onTestFinished } from 'vitest';

import { POSTGRES_IMAGE } from './support/container-images.js';
import { TEST_RUN_LABEL } from './support/test-run-label.js';
import { TestPostgres } from './support/postgres-container.js';
import { startRunProcess } from './support/test-run-process.js';

const RUN_PROCESS = new URL('./support/test-run-process.ts', import.meta.url).href;

/** Waits long enough for a Postgres to start on a loaded machine, and for the sweeper to remove it. */
const CONTAINER_TIMEOUT = 120_000;

async function dockerode() {
  return (await getContainerRuntimeClient()).container.dockerode;
}

async function containersOf(run: string): Promise<string[]> {
  const containers = await (await dockerode()).listContainers({ all: true, filters: { label: [`${TEST_RUN_LABEL}=${run}`] } });
  return containers.map((container) => container.Id);
}

async function volumesOf(containerId: string): Promise<string[]> {
  const inspected = await (await dockerode()).getContainer(containerId).inspect();
  return inspected.Mounts.flatMap((mount) => (mount.Type === 'volume' && mount.Name ? [mount.Name] : []));
}

async function existingVolumes(names: readonly string[]): Promise<string[]> {
  const docker = await dockerode();
  const found = await Promise.all(
    names.map(async (name) => {
      try {
        await docker.getVolume(name).inspect();
        return [name];
      } catch {
        return [];
      }
    }),
  );
  return found.flat();
}

/** Kills a process by its pid, if it still runs. */
function killIfRunning(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // It ended already.
  }
}

/**
 * A test's process, as the Vitest worker that runs a test: it starts the
 * process of a test run of its own and answers that process's pid.
 */
async function startTestProcess(run: string): Promise<{ testPid: number | undefined; runPid: number }> {
  const script = `import { startRunProcess } from ${JSON.stringify(RUN_PROCESS)}; const runProcess = await startRunProcess(process.argv[1]); console.log(runProcess.pid); setInterval(() => {}, 60_000);`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, run], { stdio: ['ignore', 'pipe', 'inherit'] });
  for await (const line of createInterface({ input: child.stdout })) {
    return { testPid: child.pid, runPid: Number(line) };
  }
  throw new Error(`The test process of test run ${run} ended before it started the run's process`);
}

// Rootless Podman often runs no reaper, so a run's own teardown and its sweeper are all that remove its containers (#1581).
describe('the containers of a test run', () => {
  it('removes a late container and volume of a dead run at the next run, leaving a live run alone', async () => {
    const deadRun = `test-${randomUUID()}`;
    const liveRun = `test-${randomUUID()}`;
    const deadProcess = await startRunProcess(deadRun);
    const liveProcess = await startRunProcess(liveRun);
    if (deadProcess.pid === undefined || liveProcess.pid === undefined) throw new Error('Run process has no pid');
    const deadPid = deadProcess.pid;
    const livePid = liveProcess.pid;
    const docker = await dockerode();
    const startTime = (pid: number) => {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? '';
    };
    const deadStart = startTime(deadPid);
    const liveStart = startTime(livePid);
    const labels = (run: string, identity: { pid: number; start: string; checkout?: string }) => ({ [TEST_RUN_LABEL]: run, 'aeolus-fleet.test-run-pid': String(identity.pid), 'aeolus-fleet.test-run-start': identity.start, 'aeolus-fleet.test-checkout': identity.checkout ?? process.cwd() });
    const deadIdentity = { pid: deadPid, start: deadStart };
    const liveIdentity = { pid: livePid, start: liveStart };
    const created: string[] = [];
    const volumeNames: string[] = [];
    onTestFinished(async () => {
      if (deadProcess.exitCode === null && deadProcess.signalCode === null) deadProcess.kill('SIGKILL');
      if (liveProcess.exitCode === null && liveProcess.signalCode === null) liveProcess.kill('SIGKILL');
      await Promise.allSettled(created.map((id) => docker.getContainer(id).remove({ force: true, v: true })));
      await Promise.allSettled(volumeNames.map((name) => docker.getVolume(name).remove()));
    });
    deadProcess.kill('SIGKILL');
    await new Promise<void>((resolve) => { deadProcess.once('exit', () => { resolve(); }); });
    // The existing bounded sweep ends after two empty lists, one second apart.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const volume = await docker.createVolume({ Labels: labels(deadRun, deadIdentity) });
    volumeNames.push(volume.name);
    const dead = await docker.createContainer({ Image: POSTGRES_IMAGE, Labels: labels(deadRun, deadIdentity), HostConfig: { Binds: [`${volume.name}:/var/lib/postgresql/data`] } });
    created.push(dead.id);
    const liveVolume = await docker.createVolume({ Labels: labels(liveRun, liveIdentity) });
    volumeNames.push(liveVolume.name);
    const live = await docker.createContainer({ Image: POSTGRES_IMAGE, Labels: labels(liveRun, liveIdentity), HostConfig: { Binds: [`${liveVolume.name}:/var/lib/postgresql/data`] } });
    created.push(live.id);
    const reusedRun = `test-${randomUUID()}`;
    const reused = await docker.createContainer({ Image: POSTGRES_IMAGE, Labels: labels(reusedRun, { pid: livePid, start: liveStart === '1' ? '2' : '1' }) });
    created.push(reused.id);
    const otherRun = `test-${randomUUID()}`;
    const otherLabels = labels(otherRun, { ...deadIdentity, checkout: '/other-checkout' });
    const otherVolume = await docker.createVolume({ Labels: otherLabels });
    volumeNames.push(otherVolume.name);
    const other = await docker.createContainer({ Image: POSTGRES_IMAGE, Labels: otherLabels, HostConfig: { Binds: [`${otherVolume.name}:/var/lib/postgresql/data`] } });
    created.push(other.id);

    const nextProcess = await startRunProcess(`test-${randomUUID()}`);
    onTestFinished(() => { if (nextProcess.exitCode === null && nextProcess.signalCode === null) nextProcess.kill('SIGKILL'); });

    await expect.poll(() => containersOf(deadRun), { timeout: 15_000, interval: 250 }).toEqual([]);
    await expect.poll(() => existingVolumes([volume.name]), { timeout: 15_000, interval: 250 }).toEqual([]);
    expect(await containersOf(reusedRun)).toEqual([]);
    expect(await containersOf(liveRun)).toEqual([live.id]);
    expect(await containersOf(otherRun)).toEqual([other.id]);
    expect(await existingVolumes([liveVolume.name, otherVolume.name])).toEqual([liveVolume.name, otherVolume.name]);
  }, CONTAINER_TIMEOUT);

  it(
    'are removed with their volumes when the run is killed before its teardown',
    async () => {
      const run = `test-${randomUUID()}`;
      const runProcess = await startRunProcess(run);
      onTestFinished(() => {
        killIfRunning(runProcess.pid);
      });
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      runProcess.kill('SIGKILL');

      await expect.poll(() => containersOf(run), { timeout: 60_000, interval: 500 }).toEqual([]);
      await expect.poll(() => existingVolumes(volumes), { timeout: 30_000, interval: 500 }).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it(
    'are removed with their volumes when the test that started the run is killed',
    async () => {
      const run = `test-${randomUUID()}`;
      const { testPid, runPid } = await startTestProcess(run);
      onTestFinished(() => {
        killIfRunning(testPid);
        killIfRunning(runPid);
      });
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      killIfRunning(testPid);

      await expect.poll(() => containersOf(run), { timeout: 60_000, interval: 500 }).toEqual([]);
      await expect.poll(() => existingVolumes(volumes), { timeout: 30_000, interval: 500 }).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it(
    'leave no Postgres volume behind when a teardown stops them',
    async () => {
      const run = `test-${randomUUID()}`;
      const runProcess = await startRunProcess(run);
      onTestFinished(() => {
        killIfRunning(runProcess.pid);
      });
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      await postgres.stop();

      expect(await containersOf(run)).toEqual([]);
      expect(await existingVolumes(volumes)).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it('include the shared Postgres the global setup starts, so its sweeper removes it', async () => {
    const containers = await (await dockerode()).listContainers({ filters: { label: [`${TEST_RUN_LABEL}=${inject('testRun')}`] } });

    expect(containers.map((container) => container.Image)).toContain(POSTGRES_IMAGE);
  });
});
