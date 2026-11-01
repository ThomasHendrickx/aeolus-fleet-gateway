import { answerSchema } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { answerOf, type BasketEntries } from './basket.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { ItemOutcomes } from './item-outcome.js';
import { openedOf, type DealtError } from './opened-of.js';
import type { PersonCaller } from './person-crew.js';
import type { InboxChanges, OpenedDeliveries } from './ports.js';

/** What the basket holds for a question once put: its option, none for a note alone, and its note, none when the person wrote none. */
export interface PutEntry {
  readonly questionId: string;
  readonly option: number | null;
  readonly note: string | null;
}

export type PutInBasket = (input: { caller: PersonCaller; deliveryId: string; option: number | null; note: string }) => Promise<Result<PutEntry, DealtError | DomainError<'NOT_A_QUESTION' | 'INVALID_ARGUMENTS' | 'CONFLICT'>>>;

/**
 * Use case: a person puts their answer to a question they opened in Bridge
 * into the basket (section 9, rule 1): its option and a note if they wrote
 * one, or a note alone. Nothing is sent; the question still waits on them. One entry per
 * question: picking again changes it, in its place in the order added. An
 * entry being sent goes as stored, and one the fleet refused is removed,
 * not sent again, so neither changes. A question answered elsewhere first
 * is refused saying where. Every page of the person reads the
 * basket again.
 */
export function createPutInBasket(deps: { crewPersonShip: CrewPersonShip; opened: OpenedDeliveries; entries: BasketEntries; outcomes: Pick<ItemOutcomes, 'findMany'>; changes: InboxChanges; clock: Clock }): PutInBasket {
  return async ({ caller, deliveryId, option, note }) => {
    const opened = await openedOf(deps, { caller, deliveryId });
    if (!opened.isOk) {
      return opened;
    }
    const question = opened.value;
    const questionId = question.askedQuestionId;
    if (questionId === null) {
      return refuse('NOT_A_QUESTION', 'Only an answer to a question goes in the basket');
    }
    const written = note.trim();
    const entry = { questionId, option, note: written === '' ? null : written };
    if (!answerSchema.safeParse(answerOf(entry)).success) {
      return refuse('INVALID_ARGUMENTS', 'Pick one of the options, numbered from 1, or write a note');
    }
    const kept = await deps.entries.find(caller.fleetId, { shipId: question.shipId, questionId });
    if (kept?.state === 'sending') {
      return refuse('CONFLICT', 'This answer is being sent: it goes as it was put in the basket');
    }
    if (kept?.state === 'refused') {
      return refuse('CONFLICT', 'The fleet refused this answer: remove it from the basket');
    }
    await deps.entries.save({
      fleetId: question.fleetId,
      shipId: question.shipId,
      deliveryId: question.deliveryId,
      messageId: question.messageId,
      senderShipId: question.senderShipId,
      from: question.from,
      title: question.title,
      sentAt: question.sentAt,
      ...entry,
      addedAt: kept?.addedAt ?? deps.clock.now(),
      state: 'waiting',
      refusal: null,
    });
    await deps.changes.tell({ fleetId: question.fleetId, shipId: question.shipId });
    return ok(entry);
  };
}
