/** A test container that would not stop, reported as cleanup: no test assertion failed. */
export class ContainerCleanupError extends Error {
  constructor({
    name,
    attempts,
    cause,
  }: {
    readonly name: string;
    readonly attempts: number;
    readonly cause: unknown;
  }) {
    super(
      `Test container cleanup failed, not a test failure: ${name} did not stop after ${String(attempts)} attempts. ` +
        'The run sweeper removes it.',
      { cause },
    );
    this.name = 'ContainerCleanupError';
  }
}

export interface StopContainerInput {
  readonly name: string;
  readonly stop: () => Promise<unknown>;
  readonly attempts?: number;
  readonly delayMs?: number;
}

/**
 * Stops a container, trying again when the runtime answers that the container's
 * process did not die in time (HTTP 500 `given PID did not die within timeout`):
 * under a loaded full run the runtime is slow, not broken. Once the attempts run
 * out the failure is a ContainerCleanupError, so it reads as cleanup.
 */
export async function stopContainer({
  name,
  stop,
  attempts = 5,
  delayMs = 2000,
}: StopContainerInput): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await stop();
      return;
    } catch (error) {
      last = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new ContainerCleanupError({ name, attempts, cause: last });
}
