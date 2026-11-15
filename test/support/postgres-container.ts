import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { getContainerRuntimeClient, Wait } from 'testcontainers';

import { testRunLabels } from './test-run-labels.js';

/**
 * Postgres says it is ready twice: once for the server the image's entrypoint
 * starts to initialise the database, once for the server that stays.
 */
const READY_LOG = /database system is ready to accept connections/;

/**
 * Postgres for the tests, waited for by its log and its port instead of a
 * health check. The module's own check runs every 250 ms, and on rootless
 * Podman each run is a systemd unit of its own: a full run floods the user
 * manager and leaves units behind (aeolus-fleet#554). It flushes nothing to disk: a commit
 * that waits for the disk waits behind every other test's writes, and under a
 * loaded full run Prisma Migrate's commits alone outlasted a test's time
 * (aeolus-fleet#499). Only a crash of the host loses a commit then, and no test survives
 * that anyway.
 */
export class TestPostgres extends PostgreSqlContainer {
  private readonly labels: Record<string, string>;
  private volumeName: string | undefined;
  constructor(image: string, run: string) {
    super(image);
    this.labels = testRunLabels(run);
    this.withLabels(this.labels);
    this.withCommand(['postgres', '-c', 'fsync=off']);
    this.withWaitStrategy(Wait.forAll([Wait.forLogMessage(READY_LOG, 2), Wait.forListeningPorts()]));
  }

  override async start(): Promise<StartedPostgreSqlContainer> {
    const container = await super.start();
    const stop = container.stop.bind(container);
    container.stop = async (options) => {
      const stopped = await stop(options);
      if (this.volumeName) {
        const { dockerode } = (await getContainerRuntimeClient()).container;
        await dockerode.getVolume(this.volumeName).remove();
      }
      return stopped;
    };
    return container;
  }

  /** Drops the check the module sets on start; the image defines none of its own. */
  protected override async beforeContainerCreated(): Promise<void> {
    const { dockerode } = (await getContainerRuntimeClient()).container;
    const volume = await dockerode.createVolume({ Labels: this.labels });
    this.volumeName = volume.name;
    this.hostConfig.Mounts = [{ Type: 'volume', Source: volume.name, Target: '/var/lib/postgresql/data' }];
    delete this.createOpts.Healthcheck;
    await super.beforeContainerCreated?.();
  }
}
