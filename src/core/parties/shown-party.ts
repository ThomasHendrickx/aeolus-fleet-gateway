import type { ShipId } from '@aeolus-fleet/common';

import type { McpServerCredential } from '../vault/credential.js';
import type { Party, PartyState } from './party.js';

interface ShownPartyBase {
  name: string;
  state: PartyState;
  proxyShipId: ShipId | null;
}

/** A party as the gateway keeps it, for any actor to read: never its credential, secret or crew token. */
export type ShownParty =
  | (ShownPartyBase & { kind: 'mcpServer'; url: string; credentialKind: McpServerCredential['kind']; concurrencyLimit: number })
  | (ShownPartyBase & { kind: 'mcpClient'; clientId: string })
  | (ShownPartyBase & { kind: 'a2aClient' });

/**
 * What the fleet holds for a party's proxy ship (decision 0056): its name,
 * owner and scopes; none while it has no proxy ship, or the fleet does not
 * answer, and only its name outside the actor's read reach.
 */
export interface FromFleet {
  proxyShipName: string | null;
  ownerShipId: ShipId | null;
  ownerName: string | null;
  scopes: string[] | null;
}

/** A party with its proxy ship's name, owner and scopes, read from the fleet. */
export type ListedParty = ShownParty & FromFleet;

export function shownPartyOf(party: Party): ShownParty {
  const { name, state, proxyShipId } = party;
  switch (party.kind) {
    case 'mcpServer':
      return { name, kind: party.kind, url: party.url, credentialKind: party.credential.kind, concurrencyLimit: party.concurrencyLimit, state, proxyShipId };
    case 'mcpClient':
      return { name, kind: party.kind, clientId: party.clientId, state, proxyShipId };
    case 'a2aClient':
      return { name, kind: party.kind, state, proxyShipId };
  }
}
