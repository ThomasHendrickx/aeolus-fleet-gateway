import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, GatewayCrew } from '../connection/ports.js';
import { isOpenAtArgo, type ArgoInbox } from './argo-inbox.js';
import type { ArgoInboxDoor, ArgoInboxEntry, ArgoMessage } from './ports.js';

/**
 * What the ship holds of argo's inbox in a fleet, each message open there by
 * its id: following from a position; stale, once following failed, shown
 * until the next round reads it whole again; or not let read.
 */
type Held =
  | { readonly kind: 'following'; readonly argo: ShipId; readonly afterSeq: number; readonly messages: ReadonlyMap<MessageId, ArgoMessage> }
  | { readonly kind: 'stale'; readonly messages: ReadonlyMap<MessageId, ArgoMessage> }
  | { readonly kind: 'notLetRead' };

type Following = Extract<Held, { kind: 'following' }>;

export interface FollowArgoInbox {
  /** One round over every fleet the gateway is connected to, each waiting while argo's inbox did not change, until the signal aborts. */
  round(signal: AbortSignal): Promise<void>;
  /** argo's inbox in the fleet as last read; none before the first round, or for a fleet the gateway is not connected to. */
  inboxOf(fleetId: FleetId): ArgoInbox | undefined;
}

function messageOf({ messageId, deliveryId, sender, contentType, sentAt }: ArgoInboxEntry): ArgoMessage {
  return { messageId, deliveryId, sender, contentType, sentAt };
}

function oldestFirst(messages: Iterable<ArgoMessage>): ArgoMessage[] {
  return [...messages].sort((one, other) => one.sentAt.getTime() - other.sentAt.getTime() || one.messageId.localeCompare(other.messageId));
}

/**
 * Use case: the gateway's own ship reads argo's open inbox in each fleet it
 * is connected to, by the read rule argo adds (argo's inbox, AI9; decision
 * 0034). It reads the inbox whole from the fleet's position at that moment,
 * then follows each change to a delivery to argo from there, reading that
 * message again. Its first round, after a restart, reads it whole again.
 * Without the rule it reads nothing and says so; once the rule is back it
 * reads it whole again, as it followed nothing meanwhile. While the fleet
 * does not answer it keeps what it read, and reads it whole again when
 * following fails. argo's inbox stays the one record: what the ship read
 * lives in memory only, and core sends it nothing.
 */
export function createFollowArgoInbox(deps: { connections: Pick<ConnectionStore, 'connected'>; door: ArgoInboxDoor }): FollowArgoInbox {
  const held = new Map<FleetId, Held>();

  const readWhole = async (crewToken: string, argo: ShipId): Promise<Following | undefined> => {
    const position = await deps.door.position(crewToken);
    const entries = position.isOk ? await deps.door.entries(crewToken, argo) : position;
    if (!position.isOk || !entries.isOk) {
      return undefined;
    }
    const open = entries.value.filter(({ deliveryState }) => isOpenAtArgo(deliveryState));
    return { kind: 'following', argo, afterSeq: position.value, messages: new Map(open.map((entry) => [entry.messageId, messageOf(entry)])) };
  };

  const followOn = async ({ crewToken, following, signal }: { crewToken: string; following: Following; signal: AbortSignal }): Promise<Following | undefined> => {
    const { argo } = following;
    const changes = await deps.door.changes(crewToken, { argo, afterSeq: following.afterSeq, signal });
    if (!changes.isOk) {
      return undefined;
    }
    const messages = new Map(following.messages);
    for (const messageId of new Set(changes.value.messageIds)) {
      const entry = await deps.door.entry(crewToken, { argo, messageId });
      if (!entry.isOk) {
        return undefined;
      }
      if (entry.value !== null && isOpenAtArgo(entry.value.deliveryState)) {
        messages.set(messageId, messageOf(entry.value));
      } else {
        messages.delete(messageId);
      }
    }
    return { kind: 'following', argo, afterSeq: changes.value.lastSeq, messages };
  };

  const roundOf = async ({ fleetId, crewToken }: GatewayCrew, signal: AbortSignal): Promise<void> => {
    const argo = await deps.door.argoInReach(crewToken);
    if (!argo.isOk) {
      return;
    }
    if (argo.value === null) {
      held.set(fleetId, { kind: 'notLetRead' });
      return;
    }
    const before = held.get(fleetId);
    if (before?.kind === 'following' && before.argo === argo.value) {
      held.set(fleetId, (await followOn({ crewToken, following: before, signal })) ?? { kind: 'stale', messages: before.messages });
      return;
    }
    const read = await readWhole(crewToken, argo.value);
    if (read !== undefined) {
      held.set(fleetId, read);
    }
  };

  return {
    round: async (signal) => {
      const connected = await deps.connections.connected();
      const fleetIds = new Set(connected.map(({ fleetId }) => fleetId));
      for (const fleetId of held.keys()) {
        if (!fleetIds.has(fleetId)) {
          held.delete(fleetId);
        }
      }
      await Promise.all(connected.map((crew) => roundOf(crew, signal)));
    },
    inboxOf: (fleetId) => {
      const inbox = held.get(fleetId);
      if (inbox === undefined) {
        return undefined;
      }
      return inbox.kind === 'notLetRead' ? { kind: 'notLetRead' } : { kind: 'read', messages: oldestFirst(inbox.messages.values()) };
    },
  };
}
