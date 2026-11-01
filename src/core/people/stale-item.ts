/**
 * A question or a step its asker withdrew or replaced (decision 0038; Bridge,
 * section 9, CC14): stale, no longer answerable, out of the count. A
 * withdrawal or a replacement names the question or the step by its uuid,
 * and only from the ship that asked it; a question's withdrawal names a
 * question, a step's a step. A replacement asks a new question or step: it is
 * a new item, and the replaced one links to it.
 */
import type { DeliveryId, ShipId } from '@aeolus-fleet/common';

import { titleOf } from './inbox-entry.js';
import type { PersonDelivery } from './ports.js';

export interface Stale {
  readonly kind: 'withdrawn' | 'replaced';
  /** The delivery of the replacement, a new item; none for a withdrawn question or step. */
  readonly replacementId: DeliveryId | null;
  /** When the withdrawal or the replacement was sent (ISO 8601), as the person is told it. */
  readonly at: string;
  /** The title of the replacement's new question or step; none for a withdrawn one. */
  readonly replacementTitle: string | null;
}

/** What a delivery to the person ship asks and withdraws, by question or step uuid, who sent it, when, and its title. */
export interface Asking {
  readonly deliveryId: DeliveryId;
  readonly senderShipId: ShipId;
  readonly sentAt: Date;
  readonly title: string;
  readonly askedQuestionId: string | null;
  readonly withdrawnQuestionId: string | null;
  readonly stepId: string | null;
  readonly withdrawnStepId: string | null;
}

/** Whether one delivery withdraws or replaces what the other asks: from the same asker, naming the uuid of the question or the step it asks. */
function isWithdrawing(withdrawer: Asking, asking: Asking): boolean {
  if (withdrawer.deliveryId === asking.deliveryId || withdrawer.senderShipId !== asking.senderShipId) {
    return false;
  }
  const isQuestionNamed = asking.askedQuestionId !== null && withdrawer.withdrawnQuestionId === asking.askedQuestionId;
  const isStepNamed = asking.stepId !== null && withdrawer.withdrawnStepId === asking.stepId;
  return isQuestionNamed || isStepNamed;
}

/** The delivery that withdraws or replaces the question or step this one asks, among these; none while it is open. */
export function withdrawerOf(asking: Asking, among: readonly Asking[]): Asking | undefined {
  return among.find((each) => isWithdrawing(each, asking));
}

/** Whether the question or step this one asks is withdrawn or replaced by one of these, and by which replacement. */
export function staleOf(asking: Asking, among: readonly Asking[]): Stale | null {
  const withdrawer = withdrawerOf(asking, among);
  return withdrawer === undefined ? null : staleBy(withdrawer);
}

/** How a question or step is stale by the delivery that withdraws or replaces it: a replacement asks one of its own. */
export function staleBy(withdrawer: Asking): Stale {
  const at = withdrawer.sentAt.toISOString();
  return withdrawer.askedQuestionId === null && withdrawer.stepId === null ? { kind: 'withdrawn', replacementId: null, at, replacementTitle: null } : { kind: 'replaced', replacementId: withdrawer.deliveryId, at, replacementTitle: withdrawer.title };
}

/** The question or step a replacement replaces, among these, from the same asker; none for any other delivery. */
export function replacedBy(replacement: Asking, among: readonly Asking[]): Asking | undefined {
  if (staleBy(replacement).kind === 'withdrawn') {
    return undefined;
  }
  return among.find((each) => isWithdrawing(replacement, each));
}

/** A delivery waiting for the person ship, as what it asks and withdraws: titled as Bridge lists it. */
export function askingOf(delivery: PersonDelivery): Asking {
  return { ...delivery, title: titleOf(delivery) };
}
