/** The part of the container runtime the sweep uses. */
export interface SweepRuntime {
  listContainerIds(run: string): Promise<string[]>;
  removeContainer(id: string): Promise<void>;
}

/** How long the sweep waits between two lists, and how many lists it takes at most. */
export interface SweepTiming {
  readonly delayMs: number;
  readonly maxLists: number;
}

const DEFAULT_TIMING: SweepTiming = { delayMs: 1_000, maxLists: 10 };

/**
 * Removes every container of the run, running or not, with its anonymous
 * volumes. A container whose create request was still in flight when the run's
 * process died can appear after a list, so the sweep removes what it lists and
 * lists again after a short delay, until two lists in a row are empty. It stops
 * after the most lists the timing allows.
 */
export async function sweep(runtime: SweepRuntime, { run, timing = DEFAULT_TIMING }: { run: string; timing?: SweepTiming }): Promise<void> {
  let previous: string[] | undefined;
  for (let lists = 1; lists <= timing.maxLists; lists++) {
    const ids = await runtime.listContainerIds(run);
    if (previous?.length === 0 && ids.length === 0) {
      return;
    }
    // A container the run's teardown removes meanwhile answers not found: it is gone either way.
    await Promise.allSettled(ids.map((id) => runtime.removeContainer(id)));
    previous = ids;
    if (lists === timing.maxLists) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, timing.delayMs));
  }
}
