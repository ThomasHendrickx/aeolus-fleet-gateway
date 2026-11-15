import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Identifies the checkout and process that owns a test run's resources. */
export function testRunLabels(run: string, readStat: (path: string) => string = (path) => readFileSync(path, 'utf8')): Record<string, string> {
  let start: string | undefined;
  try {
    const stat = readStat(`/proc/${String(process.pid)}/stat`);
    start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    // A nonnumeric marker keeps the sweeper from treating an unreadable process as dead.
    start = 'unavailable';
  }
  if (!start) throw new Error('Could not read the test run process start time');
  return {
    'aeolus-fleet.test-run': run,
    'aeolus-fleet.test-checkout': resolve(fileURLToPath(new URL('../..', import.meta.url))),
    'aeolus-fleet.test-run-pid': String(process.pid),
    'aeolus-fleet.test-run-start': start,
  };
}
