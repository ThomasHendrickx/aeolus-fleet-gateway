import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Wait } from 'testcontainers';

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
  constructor(image: string) {
    super(image);
    this.withCommand(['postgres', '-c', 'fsync=off']);
    this.withWaitStrategy(Wait.forAll([Wait.forLogMessage(READY_LOG, 2), Wait.forListeningPorts()]));
  }

  /** Drops the check the module sets on start; the image defines none of its own. */
  protected override async beforeContainerCreated(): Promise<void> {
    delete this.createOpts.Healthcheck;
    await super.beforeContainerCreated?.();
  }
}
