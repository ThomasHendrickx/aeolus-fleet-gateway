import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetSwitches, InstallationRequests, RequestHasher } from './ports.js';
import { earlierAnswer } from './request-id.js';

export type SetFleetEnabled = (input: {
  requestId: string;
  fleetId: FleetId;
  isEnabled: boolean;
}) => Promise<Result<{ fleetId: FleetId; isEnabled: boolean }, DomainError<'REQUEST_ID_USED' | 'NO_NETWORKING_PLUGIN' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the hosting service switches the gateway on or off for a fleet
 * (decision 0021). Off keeps everything of the fleet, so on again resumes.
 * The gateway does not switch on for a fleet without a registered networking
 * plugin (interop I-3): without one, every outside party would reach every
 * ship. A connected fleet is asked at once; a fleet the gateway is not
 * connected to yet is asked when argo connects it. A refused switch records
 * nothing, so the same request id may try again. A replayed request id
 * answers what it answered first and changes nothing.
 */
export function createSetFleetEnabled(deps: {
  switches: FleetSwitches;
  requests: InstallationRequests;
  hasher: RequestHasher;
  clock: Clock;
  connections: ConnectionStore;
  door: FleetDoor;
}): SetFleetEnabled {
  return async ({ requestId, fleetId, isEnabled }) => {
    const requestHash = deps.hasher.hash(`setEnabled ${fleetId} ${String(isEnabled)}`);
    const earlier = await earlierAnswer(deps.requests, { requestId, requestHash });
    if (earlier !== undefined) {
      return 'isOk' in earlier ? earlier : ok({ fleetId, isEnabled: earlier.isEnabled === true });
    }
    const crew = isEnabled ? await deps.connections.find(fleetId) : undefined;
    if (crew) {
      const plugin = await deps.door.hasNetworkingPlugin(crew.crewToken);
      if (!plugin.isOk) {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not say whether it has a networking plugin: ${plugin.error.message}`);
      }
      if (!plugin.value) {
        return refuse('NO_NETWORKING_PLUGIN', 'The gateway switches on only for a fleet with a registered networking plugin');
      }
    }
    const at = deps.clock.now();
    await deps.switches.set(fleetId, { isEnabled, at });
    await deps.requests.record({ requestId, kind: 'setEnabled', requestHash, fleetId, isEnabled, at });
    return ok({ fleetId, isEnabled });
  };
}
