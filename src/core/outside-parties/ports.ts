import type { FleetId } from '@aeolus-fleet/common';

import type { ActorCredential } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/** Whether a fleet's outside parties are on, and when it was last set; off for a fleet never set (interop I-3). */
export interface OutsidePartySwitches {
  isOn(fleetId: FleetId): Promise<boolean>;
  set(fleetId: FleetId, switched: { isOn: boolean; at: Date }): Promise<void>;
}

/** Outbound port: the fleet's network, as the actor reads it. */
export interface FleetNetwork {
  /** Whether the fleet applies no network rules, so every ship reaches every ship. */
  isOpen(as: ActorCredential): Promise<Result<boolean, FleetRefusal>>;
}
