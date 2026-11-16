/**
 * @aeolus-fleet/common 0.41.0, the common core 0.41.0 answers by, packed from
 * core's release branch hotfix/0.41.x into test/fixtures/common-0.41.0 while
 * it is not on npm. A process started with its environment runs the
 * gateway's source on it in place of the installed common: core 0.41.0's
 * common no longer exports FOLLOW_WAIT_MAX_SECONDS (long-poll W8).
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TARBALL = fileURLToPath(new URL('../fixtures/common-0.41.0/aeolus-fleet-common-0.41.0.tgz', import.meta.url));
const ZOD = fileURLToPath(new URL('../../node_modules/zod', import.meta.url));
const REGISTER = fileURLToPath(new URL('./common-0.41.0-register.ts', import.meta.url));

/** The variable the register hook reads: a file whose node_modules holds common 0.41.0. */
export const COMMON_PARENT_URL_VARIABLE = 'AEOLUS_TEST_COMMON_PARENT_URL';

/** Unpacks common 0.41.0 beside the zod the gateway runs on, and answers the environment a process runs on it with. */
export async function common041Environment(): Promise<Record<string, string>> {
  const folder = await mkdtemp(join(tmpdir(), 'gateway-common-0.41.0-'));
  const scope = join(folder, 'node_modules', '@aeolus-fleet');
  await mkdir(scope, { recursive: true });
  await run('tar', ['-xzf', TARBALL, '-C', scope]);
  await rename(join(scope, 'package'), join(scope, 'common'));
  await symlink(ZOD, join(folder, 'node_modules', 'zod'));
  const parent = join(folder, 'package.json');
  await writeFile(parent, JSON.stringify({ name: 'gateway-on-common-0.41.0', private: true, type: 'module' }));
  return { NODE_OPTIONS: `--import ${pathToFileURL(REGISTER).href}`, [COMMON_PARENT_URL_VARIABLE]: pathToFileURL(parent).href };
}
