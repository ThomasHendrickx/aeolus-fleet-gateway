/**
 * The minimum core version check (decision 0049, docs/compatibility.md): the
 * gateway reads core's version at start and refuses to run against an older
 * core, saying both versions, as common's coreVersionRefusal words it.
 */
import { coreVersionRefusal, type VersionFetch } from '@aeolus-fleet/common';

import { ConfigError } from '../../config.js';
import { runningVersion } from '../http/version.js';

export type { VersionFetch };

/** The oldest core the gateway runs against: the ship contract it calls (docs/compatibility.md). */
export const MINIMUM_CORE_VERSION = '0.35.0';

/** Stops the start when the fleet's core is older than the gateway needs, or does not say its version. */
export async function requireCoreVersion(fleetUrl: string, fetch: VersionFetch = globalThis.fetch): Promise<void> {
  const refusal = await coreVersionRefusal({ packageName: 'gateway', version: runningVersion(), minimum: MINIMUM_CORE_VERSION, fleetUrl, fetch });
  if (refusal !== undefined) {
    throw new ConfigError(refusal);
  }
}
