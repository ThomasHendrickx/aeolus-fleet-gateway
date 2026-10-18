import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { DiscoveredShip, Discovery, ShipAliases } from '../../src/core/mcp-in/ports.js';
import { err, ok } from '../../src/core/shared/result.js';
import type { FleetRefusal } from '../../src/core/connection/ports.js';

export const CRM_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9cr2';
export const ARGO_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9arg';

/** Aliases as a test reads them: the ship id's last four characters, spelled out. */
export const fakeAliases: ShipAliases = { aliasOf: (_fleetId: FleetId, shipId: ShipId) => `a${shipId.slice(-4)}` };

/** A ship as discover answers it, with a statement by its crew. */
export function aDiscoveredShip(overrides: Partial<DiscoveredShip> = {}): DiscoveredShip {
  return {
    shipId: CRM_SHIP_ID,
    kind: 'app',
    statement: {
      by: 'crew',
      summary: 'The CRM: contacts and deals.',
      capabilities: [
        {
          name: 'list_deals',
          title: 'List deals',
          description: "Lists a contact's deals.",
          inputSchema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
          outputSchema: { type: 'object', properties: { deals: { type: 'array' } } },
          inputModes: ['application/vnd.aeolus.mcp-tool+json; name=list_deals'],
          outputModes: ['application/vnd.aeolus.mcp-result+json; name=list_deals'],
        },
      ],
    },
    ...overrides,
  };
}

/** The fleet's discover, as the proxy ship's crew calls it: the ships set, or the refusal set. */
export function fakeDiscovery(ships: DiscoveredShip[] = [aDiscoveredShip()]) {
  const state: { ships: DiscoveredShip[]; refusal: FleetRefusal | undefined } = { ships, refusal: undefined };
  const askedWith: string[] = [];
  const discovery: Discovery & { state: typeof state; askedWith: string[] } = {
    state,
    askedWith,
    discover: (crewToken) => {
      askedWith.push(crewToken);
      return Promise.resolve(state.refusal === undefined ? ok(state.ships) : err(state.refusal));
    },
  };
  return discovery;
}
