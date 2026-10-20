import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/** Whether a fleet's outside parties are on, and when it was last set; off for a fleet never set (interop I-3). */
export interface OutsidePartySwitches {
  isOn(fleetId: FleetId): Promise<boolean>;
  set(fleetId: FleetId, switched: { isOn: boolean; at: Date }): Promise<void>;
}

/** The credential an actor called the gateway with, passed on so the fleet answers as that actor. */
export interface ActorCredential {
  cookie?: string;
  crewToken?: string;
}

/** Outbound port: the fleet's network, as the actor reads it. */
export interface FleetNetwork {
  /** Whether the fleet applies no network rules, so every ship reaches every ship. */
  isOpen(as: ActorCredential): Promise<Result<boolean, FleetRefusal>>;
}
