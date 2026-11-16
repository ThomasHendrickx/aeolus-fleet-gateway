/**
 * Loaded with node --import: resolves @aeolus-fleet/common, and its subpaths,
 * from the folder common041Environment unpacked common 0.41.0 into, so the
 * gateway's source runs on it in place of the installed common.
 */
import { registerHooks } from 'node:module';

const parentURL = process.env.AEOLUS_TEST_COMMON_PARENT_URL;
const COMMON = '@aeolus-fleet/common';

if (parentURL !== undefined) {
  registerHooks({
    // eslint-disable-next-line @typescript-eslint/max-params -- Node's resolve hook takes these three.
    resolve: (specifier, context, nextResolve) =>
      specifier === COMMON || specifier.startsWith(`${COMMON}/`) ? nextResolve(specifier, { ...context, parentURL }) : nextResolve(specifier, context),
  });
}
