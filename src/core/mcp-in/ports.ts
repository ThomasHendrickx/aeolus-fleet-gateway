import type { FleetId, ShipId, ShipKind } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/** One thing a ship offers, as its statement says it (decision 0047): MCP's tool fields and A2A's modes. */
export interface Capability {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** The media types to send it, the first the one to use. */
  inputModes?: string[];
  /** The media types that come back, the first the one to expect. */
  outputModes?: string[];
}

/** A ship's statement as discovery shows it: its crew's, the note it was commissioned with, or none. */
export type DiscoveredStatement = { by: 'crew'; summary: string; capabilities: Capability[] } | { by: 'commission' } | null;

/** A ship the caller may send to now, as discover answers it. */
export interface DiscoveredShip {
  shipId: ShipId;
  kind: ShipKind;
  statement: DiscoveredStatement;
}

/** Outbound port: the fleet's discover, as a proxy ship's crew calls it. */
export interface Discovery {
  discover(crewToken: string): Promise<Result<DiscoveredShip[], FleetRefusal>>;
}

/**
 * Outbound port: the name an outside client knows a ship by. Derived, never
 * stored, the same for the same ship, and telling nothing of the ship's name
 * or id: the gateway translates both ways, as NAT does.
 */
export interface ShipAliases {
  aliasOf(fleetId: FleetId, shipId: ShipId): string;
}
