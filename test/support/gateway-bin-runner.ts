import { startProcessGroup } from './gateway-bin.js';

/**
 * A stand-in for a test run: starts a long-lived process in its own group,
 * says its pid, and then either exits on its own or waits for a signal, as the
 * mode in the first argument says. gateway-bin.test.ts ends it and looks for the pid.
 */
const mode = process.argv[2];
const child = startProcessGroup(['sleep', '600'], {});
process.stdout.write(`${String(child.pid)}\n`);
if (mode === 'exit') {
  process.exit(0);
}
setInterval(() => undefined, 1_000);
