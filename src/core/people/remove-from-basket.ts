import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { handledOf, type DealDeps, type DealtError } from './opened-of.js';
import type { PersonCaller } from './person-crew.js';
import { standingBasketOf, type BasketDeps } from './read-basket.js';
import { takeOutUnsent } from './send-basket.js';

export type RemoveFromBasket = (input: { caller: PersonCaller; questionId: string }) => Promise<Result<{ questionId: string }, DealtError | DomainError<'NOT_IN_BASKET' | 'CONFLICT'>>>;

/**
 * Use case: the person removes an entry from the basket (section 9). One
 * waiting leaves it, and its question still waits on them. One the fleet
 * refused leaves it and its question is done, as not sent; kept while the
 * fleet does not take that, so they can remove it again. One whose question
 * its asker withdrew or replaced leaves it, and the question is done as
 * such; one answered elsewhere just leaves. One being sent goes as stored.
 */
export function createRemoveFromBasket(deps: BasketDeps & DealDeps): RemoveFromBasket {
  return async ({ caller, questionId }) => {
    const basket = await standingBasketOf(deps, caller);
    if (!basket.isOk) {
      return basket;
    }
    const found = basket.value.entries.find(({ entry }) => entry.questionId === questionId);
    if (found === undefined) {
      return refuse('NOT_IN_BASKET', 'That answer is not in your basket: read it again');
    }
    const { entry, standing } = found;
    switch (standing.kind) {
      case 'sending':
        return refuse('CONFLICT', 'This answer is being sent: it goes as it was put in the basket');
      case 'refused': {
        const question = basket.value.opened.find(({ deliveryId }) => deliveryId === entry.deliveryId);
        if (question !== undefined) {
          const handled = await handledOf(deps, { caller, delivery: question, as: { place: 'bridge', kind: 'notSent', option: entry.option } });
          if (!handled.isOk) {
            return handled;
          }
        }
        await deps.entries.remove(entry.fleetId, { shipId: entry.shipId, questionId });
        break;
      }
      case 'waiting':
        await deps.entries.remove(entry.fleetId, { shipId: entry.shipId, questionId });
        break;
      case 'withdrawn':
      case 'replaced':
      case 'dealtElsewhere':
        await takeOutUnsent(deps, { caller, basket: basket.value, entry, standing });
        break;
    }
    await deps.changes.tell({ fleetId: caller.fleetId, shipId: basket.value.crew.shipId });
    return ok({ questionId });
  };
}
