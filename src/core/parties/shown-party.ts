import type { ShipId } from '@aeolus-fleet/common';

import type { McpServerCredential } from '../vault/credential.js';
import type { Party, PartyState } from './party.js';

interface ShownPartyBase {
  name: string;
  ownerShipId: ShipId;
  state: PartyState;
  proxyShipId: ShipId | null;
}

/** A party as argo reads it: never its credential, secret or crew token. */
export type ShownParty =
  | (ShownPartyBase & { kind: 'mcpServer'; url: string; credentialKind: McpServerCredential['kind']; concurrencyLimit: number })
  | (ShownPartyBase & { kind: 'mcpClient'; clientId: string })
  | (ShownPartyBase & { kind: 'person'; email: string; isSignedIn: boolean });

export function shownPartyOf(party: Party): ShownParty {
  const { name, ownerShipId, state, proxyShipId } = party;
  switch (party.kind) {
    case 'mcpServer':
      return { name, kind: party.kind, url: party.url, credentialKind: party.credential.kind, ownerShipId, concurrencyLimit: party.concurrencyLimit, state, proxyShipId };
    case 'mcpClient':
      return { name, kind: party.kind, clientId: party.clientId, ownerShipId, state, proxyShipId };
    case 'person':
      return { name, kind: party.kind, email: party.email, isSignedIn: party.subject !== null, ownerShipId, state, proxyShipId };
  }
}
