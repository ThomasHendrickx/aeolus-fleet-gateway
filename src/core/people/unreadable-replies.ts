/** Replies the gateway sent back for unreadable questions or steps, hidden from person reads. */
import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

export interface UnreadableReplies {
  save(fleetId: FleetId, reply: { readonly shipId: ShipId; readonly messageId: MessageId }): Promise<void>;
  among(fleetId: FleetId, look: { readonly shipId: ShipId; readonly messageIds: readonly MessageId[] }): Promise<ReadonlySet<MessageId>>;
}
