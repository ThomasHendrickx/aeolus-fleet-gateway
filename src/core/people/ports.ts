/**
 * A signed-in person's person ship, which the gateway crews for their
 * messaging (decisions 0054, 0057): the fleet's calls it makes as their
 * account, and the one crew every client of the person shares.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/** A call the gateway makes for an account: the account's token beside the gateway's own crew token, so the account acts through the gateway's ship. */
export interface AccountCall {
  readonly crewToken: string;
  readonly accountToken: string;
  readonly shipId: ShipId;
}

/** Outbound port: the fleet's calls for an account's own person ship (aeolus-fleet #990). */
export interface AccountDoor {
  /** A new starting prompt for the ship while it awaits crew: its secret. */
  startingPrompt(call: AccountCall): Promise<Result<{ secret: string }, FleetRefusal>>;
  /** Frees the ship from the crew that has it, so it can be crewed again. */
  release(call: AccountCall): Promise<Result<undefined, FleetRefusal>>;
}

/** The crew token the gateway holds for a person ship: one crew, shared by every client of its person. */
export interface PersonCrew {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly crewToken: string;
  readonly crewedAt: Date;
}

export interface PersonCrews {
  find(fleetId: FleetId, shipId: ShipId): Promise<PersonCrew | undefined>;
  save(crew: PersonCrew): Promise<void>;
}
