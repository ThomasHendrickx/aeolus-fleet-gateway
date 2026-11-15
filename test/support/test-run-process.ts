import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

const SWEEPER = new URL('./container-sweeper.ts', import.meta.url).href;

/**
 * A test run's process: it starts the sweeper for its run, then waits to be
 * killed, as a run interrupted mid-test. Its stdin is a pipe from the process
 * that starts it, and it ends when the pipe closes, so a test that fails or is
 * interrupted takes the run, and with it the run's containers, along.
 */
export async function startRunProcess(run: string): Promise<ChildProcess> {
  const script = `import { startContainerSweeper } from ${JSON.stringify(SWEEPER)}; await startContainerSweeper(process.argv[1]); console.log('sweeping'); process.stdin.on('end', () => process.exit()); process.stdin.resume();`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, run], { stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      if (line === 'sweeping') {
        return child;
      }
      throw new Error(`The process of test run ${run} said ${line} instead of sweeping`);
    }
    throw new Error(`The process of test run ${run} ended before it started its sweeper`);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}
