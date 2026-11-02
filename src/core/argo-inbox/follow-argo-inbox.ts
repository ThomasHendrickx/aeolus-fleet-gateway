import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, GatewayCrew } from '../connection/ports.js';
import { argoTitleOf, isOpenAtArgo, type ArgoInbox, type DoneAtArgo, type MessageDoneAtArgo } from './argo-inbox.js';
import type { ArgoInboxChange, ArgoInboxDoor, ArgoInboxEntry, ArgoMessage } from './ports.js';

/**
 * What the ship holds of argo's inbox in a fleet, each message open there by
 * its id: following from a position; stale, once following failed, shown
 * until the next round reads it whole again; or not let read.
 */
type Held =
  | { readonly kind: 'following'; readonly argo: ShipId; readonly afterSeq: number; readonly messages: ReadonlyMap<MessageId, ArgoMessage>; readonly lastDone: DoneAtArgo | null }
  | { readonly kind: 'stale'; readonly argo: ShipId; readonly messages: ReadonlyMap<MessageId, ArgoMessage>; readonly lastDone: DoneAtArgo | null }
  | { readonly kind: 'notLetRead' };

type Following = Extract<Held, { kind: 'following' }>;

export interface FollowArgoInbox {
  /** One round over every fleet the gateway is connected to, each waiting while argo's inbox did not change, until the signal aborts. */
  readonly round: (signal: AbortSignal) => Promise<void>;
  /** argo's inbox in the fleet as last read; none before the first round, or for a fleet the gateway is not connected to. */
  readonly inboxOf: (fleetId: FleetId) => ArgoInbox | undefined;
  /** When the message was done at argo and by which account, as the ship saw it done; none for one it did not see done, as while the gateway was down. */
  readonly doneAtArgo: (fleetId: FleetId, messageId: MessageId) => MessageDoneAtArgo | undefined;
}

function messageOf(entry: ArgoInboxEntry): ArgoMessage {
  const { messageId, deliveryId, sender, contentType, sentAt, askedQuestionId, withdrawnQuestionId } = entry;
  return { messageId, deliveryId, sender, contentType, sentAt, title: argoTitleOf(entry), askedQuestionId, withdrawnQuestionId };
}

/** What a fleet's page shows of argo's inbox, to tell whether a round changed it. */
function shownOf(held: Held | undefined): string {
  if (held === undefined || held.kind === 'notLetRead') {
    return held?.kind ?? 'none';
  }
  return JSON.stringify({ messageIds: [...held.messages.keys()], lastDone: held.lastDone });
}

/** Who did a message done at argo, by the newest change to it. */
function doneOf(message: ArgoMessage, change: ArgoInboxChange): DoneAtArgo {
  return { title: message.title, at: change.occurredAt, byShipId: change.actorShipId, signedInAccountId: change.signedInAccountId };
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
 * following fails. A message it sees leave the open inbox is kept done at
 * argo, when and by which account, as the change said. argo's inbox stays the
 * one record: what the ship read lives in memory only, and core sends it
 * nothing. It keeps the newest message it saw leave the open inbox, and who
 * did it, and tells each round that changed what it holds, so the pages that
 * show it read it again.
 */
export function createFollowArgoInbox(deps: { connections: Pick<ConnectionStore, 'connected'>; door: ArgoInboxDoor; onChanged?: (fleetId: FleetId) => void }): FollowArgoInbox {
  const held = new Map<FleetId, Held>();
  const done = new Map<FleetId, Map<MessageId, MessageDoneAtArgo>>();

  const readWhole = async ({ crewToken, argo, lastDone }: { crewToken: string; argo: ShipId; lastDone: DoneAtArgo | null }): Promise<Following | undefined> => {
    const position = await deps.door.position(crewToken);
    const listed = position.isOk ? await deps.door.entries(crewToken, argo) : position;
    if (!position.isOk || !listed.isOk) {
      return undefined;
    }
    // Only the open messages are read whole, for their titles: argo's done ones may be many.
    const read = await Promise.all(listed.value.filter(({ deliveryState }) => isOpenAtArgo(deliveryState)).map(({ messageId }) => deps.door.entry(crewToken, { argo, messageId })));
    const messages = new Map<MessageId, ArgoMessage>();
    for (const entry of read) {
      if (!entry.isOk) {
        return undefined;
      }
      if (entry.value !== null && isOpenAtArgo(entry.value.deliveryState)) {
        messages.set(entry.value.messageId, messageOf(entry.value));
      }
    }
    return { kind: 'following', argo, afterSeq: position.value, messages, lastDone };
  };

  const followOn = async ({ fleetId, crewToken, following, signal }: { fleetId: FleetId; crewToken: string; following: Following; signal: AbortSignal }): Promise<Following | undefined> => {
    const { argo } = following;
    const changes = await deps.door.changes(crewToken, { argo, afterSeq: following.afterSeq, signal });
    if (!changes.isOk) {
      return undefined;
    }
    const messages = new Map(following.messages);
    let { lastDone } = following;
    // The last change to each message is the one that left it as it is now.
    const newest = new Map(changes.value.changes.map((change): [MessageId, ArgoInboxChange] => [change.messageId, change]));
    for (const [messageId, change] of newest) {
      const entry = await deps.door.entry(crewToken, { argo, messageId });
      if (!entry.isOk) {
        return undefined;
      }
      const held = messages.get(messageId);
      if (entry.value !== null && isOpenAtArgo(entry.value.deliveryState)) {
        messages.set(messageId, messageOf(entry.value));
      } else {
        messages.delete(messageId);
        done.set(fleetId, new Map(done.get(fleetId)).set(messageId, { at: change.occurredAt, accountId: change.signedInAccountId ?? change.actorAccountId }));
        if (held !== undefined) {
          lastDone = lastDone !== null && lastDone.at > change.occurredAt ? lastDone : doneOf(held, change);
        }
      }
    }
    return { kind: 'following', argo, afterSeq: changes.value.lastSeq, messages, lastDone };
  };

  const nextOf = async ({ fleetId, crewToken, before }: { fleetId: FleetId; crewToken: string; before: Held | undefined }, signal: AbortSignal): Promise<Held | undefined> => {
    const argo = await deps.door.argoInReach(crewToken);
    if (!argo.isOk) {
      return before;
    }
    if (argo.value === null) {
      return { kind: 'notLetRead' };
    }
    if (before?.kind === 'following' && before.argo === argo.value) {
      return (await followOn({ fleetId, crewToken, following: before, signal })) ?? { kind: 'stale', argo: before.argo, messages: before.messages, lastDone: before.lastDone };
    }
    return (await readWhole({ crewToken, argo: argo.value, lastDone: before === undefined || before.kind === 'notLetRead' ? null : before.lastDone })) ?? before;
  };

  const roundOf = async ({ fleetId, crewToken }: GatewayCrew, signal: AbortSignal): Promise<void> => {
    const before = held.get(fleetId);
    const next = await nextOf({ fleetId, crewToken, before }, signal);
    if (next === undefined) {
      return;
    }
    held.set(fleetId, next);
    if (shownOf(next) !== shownOf(before)) {
      deps.onChanged?.(fleetId);
    }
  };

  return {
    round: async (signal) => {
      const connected = await deps.connections.connected();
      const fleetIds = new Set(connected.map(({ fleetId }) => fleetId));
      for (const fleetId of held.keys()) {
        if (!fleetIds.has(fleetId)) {
          held.delete(fleetId);
          done.delete(fleetId);
        }
      }
      await Promise.all(connected.map((crew) => roundOf(crew, signal)));
    },
    inboxOf: (fleetId) => {
      const inbox = held.get(fleetId);
      if (inbox === undefined) {
        return undefined;
      }
      return inbox.kind === 'notLetRead' ? { kind: 'notLetRead' } : { kind: 'read', argo: inbox.argo, messages: oldestFirst(inbox.messages.values()), lastDone: inbox.lastDone };
    },
    doneAtArgo: (fleetId, messageId) => done.get(fleetId)?.get(messageId),
  };
}
