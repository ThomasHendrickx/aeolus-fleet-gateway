import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Identifies the checkout and process that owns a test run's resources. */
export function testRunLabels(run: string): Record<string, string> {
  const stat = readFileSync(`/proc/${String(process.pid)}/stat`, 'utf8');
  const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  if (!start) throw new Error('Could not read the test run process start time');
  return {
    'aeolus-fleet.test-run': run,
    'aeolus-fleet.test-checkout': resolve(fileURLToPath(new URL('../..', import.meta.url))),
    'aeolus-fleet.test-run-pid': String(process.pid),
    'aeolus-fleet.test-run-start': start,
  };
}
