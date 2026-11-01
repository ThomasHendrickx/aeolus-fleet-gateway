/**
 * A question its asker withdrew or replaced (decision 0038; Bridge,
 * section 9): stale, no longer answerable, out of the count. A withdrawal
 * or a replacement names the question by its uuid, and only from the ship
 * that asked it. A replacement asks a new question: it is a new item, and
 * the replaced question links to it.
 */
import type { DeliveryId, ShipId } from '@aeolus-fleet/common';

export interface Stale {
  readonly kind: 'withdrawn' | 'replaced';
  /** The delivery of the replacement, a new item; none for a withdrawn question. */
  readonly replacementId: DeliveryId | null;
}

/** What a delivery to the person ship asks and withdraws, by question uuid, and who sent it. */
export interface Asking {
  readonly deliveryId: DeliveryId;
  readonly senderShipId: ShipId;
  readonly askedQuestionId: string | null;
  readonly withdrawnQuestionId: string | null;
}

/** The delivery that withdraws or replaces the question this one asks, among these; none while it is open. */
export function withdrawerOf(question: Asking, among: readonly Asking[]): Asking | undefined {
  const asked = question.askedQuestionId;
  if (asked === null) {
    return undefined;
  }
  return among.find(({ deliveryId, senderShipId, withdrawnQuestionId }) => deliveryId !== question.deliveryId && senderShipId === question.senderShipId && withdrawnQuestionId === asked);
}

/** Whether the question this one asks is withdrawn or replaced by one of these, and by which replacement. */
export function staleOf(question: Asking, among: readonly Asking[]): Stale | null {
  const withdrawer = withdrawerOf(question, among);
  if (withdrawer === undefined) {
    return null;
  }
  return withdrawer.askedQuestionId === null ? { kind: 'withdrawn', replacementId: null } : { kind: 'replaced', replacementId: withdrawer.deliveryId };
}
