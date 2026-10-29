import type { FleetId } from '@aeolus-fleet/common';

import type { ActorCredential } from '../../src/core/actors/credential-of.js';
import type { FleetNetwork, OutsidePartySwitches } from '../../src/core/outside-parties/ports.js';
import { err, ok } from '../../src/core/shared/result.js';

/** Outside party switches in memory: off for a fleet never set. */
export function memoryOutsidePartySwitches(): OutsidePartySwitches & { held: Map<FleetId, { isOn: boolean; at: Date }> } {
  const held = new Map<FleetId, { isOn: boolean; at: Date }>();
  return {
    held,
    isOn: (fleetId) => Promise.resolve(held.get(fleetId)?.isOn === true),
    set: (fleetId, switched) => {
      held.set(fleetId, switched);
      return Promise.resolve();
    },
  };
}

/** The fleet's network as an actor reads it: open (no rules applied) or with rules, and who read it. */
export function fakeFleetNetwork(network: { isOpen: boolean; isAnswering?: boolean }): FleetNetwork & { readers: ActorCredential[] } {
  const readers: ActorCredential[] = [];
  return {
    readers,
    isOpen: (as) => {
      readers.push(as);
      return Promise.resolve(network.isAnswering === false ? err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }) : ok(network.isOpen));
    },
  };
}
