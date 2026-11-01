import { ok, type Result } from '../shared/result.js';
import type { BasketEntry, BasketStanding } from './basket.js';
import { doneIfStale } from './open-delivery.js';
import type { DealDeps } from './opened-of.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import { standingBasketOf, type BasketDeps, type StandingBasket } from './read-basket.js';

/** An entry Send skipped and took out: its question withdrawn or replaced by its asker, or dealt with elsewhere first. */
export interface Skipped {
  readonly questionId: string;
  readonly title: string;
  readonly kind: 'withdrawn' | 'replaced' | 'dealtElsewhere';
}

/** What Send did: how many answers are being sent, and the entries it skipped. */
export interface BasketSent {
  readonly sending: number;
  readonly skipped: Skipped[];
}

export type SendBasket = (caller: PersonCaller) => Promise<Result<BasketSent, PersonCrewError>>;

/**
 * Use case: the person presses Send N answers (section 9, rule 3); no clock
 * sends the basket. The answers sent before are cleared, as a new send
 * starts. Each entry waiting is first stored as sending, then the gateway's
 * sender is woken to send them, each on its own, so a closed page or a
 * restart loses none. An entry whose question its asker withdrew or
 * replaced, or that was answered elsewhere first, is not sent: Send skips
 * it, says so, and takes it out; the question is done as a withdrawn or
 * replaced one is (rule 5). One the fleet refused stays until removed.
 * While the fleet does not answer what waits, Send stores each entry
 * waiting as sending all the same, as the gateway knows it, and the sender
 * checks each at send time (aeolus-fleet#1550).
 */
export function createSendBasket(deps: BasketDeps & DealDeps & { sendNow: () => void }): SendBasket {
  return async (caller) => {
    const basket = await standingBasketOf(deps, caller);
    if (!basket.isOk && (basket.error.kind === 'FLEET_UNAVAILABLE' || basket.error.kind === 'KEY_UNAVAILABLE')) {
      return sendAsKept(deps, caller);
    }
    if (!basket.isOk) {
      return basket;
    }
    const skipped: Skipped[] = [];
    let sending = 0;
    for (const { entry, standing } of basket.value.entries) {
      switch (standing.kind) {
        case 'waiting':
          await deps.entries.save({ ...entry, state: 'sending' });
          sending += 1;
          break;
        case 'sending':
          sending += 1;
          break;
        case 'sent':
          await deps.entries.remove(entry.fleetId, { shipId: entry.shipId, questionId: entry.questionId });
          break;
        case 'refused':
          break;
        case 'withdrawn':
        case 'replaced':
        case 'dealtElsewhere':
          await takeOutUnsent(deps, { caller, basket: basket.value, entry, standing });
          skipped.push({ questionId: entry.questionId, title: entry.title, kind: standing.kind });
          break;
      }
    }
    return sent(deps, { caller, shipId: basket.value.crew.shipId, sending, skipped });
  };
}

/**
 * Send while the fleet does not answer what waits: each entry waiting is
 * stored as sending from what the gateway keeps alone, but one it knows was
 * answered elsewhere first, which is taken out; whether its asker withdrew
 * or replaced it is checked at send time.
 */
async function sendAsKept(deps: BasketDeps & DealDeps & { sendNow: () => void }, caller: PersonCaller): Promise<Result<BasketSent, PersonCrewError>> {
  const crew = await personCrewOf(deps.crewPersonShip, caller);
  if (!crew.isOk) {
    return crew;
  }
  const { shipId } = crew.value;
  const entries = await deps.entries.list(caller.fleetId, shipId);
  const outcomes = entries.length === 0 ? [] : await deps.outcomes.findMany(caller.fleetId, { shipId, deliveryIds: entries.map(({ deliveryId }) => deliveryId) });
  const isDealt = new Set<string>(outcomes.map(({ deliveryId }) => deliveryId));
  const skipped: Skipped[] = [];
  let sending = 0;
  for (const entry of entries) {
    switch (entry.state) {
      case 'waiting':
        if (isDealt.has(entry.deliveryId)) {
          await deps.entries.remove(entry.fleetId, { shipId, questionId: entry.questionId });
          skipped.push({ questionId: entry.questionId, title: entry.title, kind: 'dealtElsewhere' });
        } else {
          await deps.entries.save({ ...entry, state: 'sending' });
          sending += 1;
        }
        break;
      case 'sending':
        sending += 1;
        break;
      case 'sent':
        await deps.entries.remove(entry.fleetId, { shipId, questionId: entry.questionId });
        break;
      case 'refused':
        break;
    }
  }
  return sent(deps, { caller, shipId, sending, skipped });
}

/** Wakes the sender when any answer is to be sent, and tells the person's pages. */
async function sent(deps: Pick<DealDeps, 'changes'> & { sendNow: () => void }, done: { caller: PersonCaller; shipId: BasketEntry['shipId']; sending: number; skipped: Skipped[] }): Promise<Result<BasketSent, PersonCrewError>> {
  const { caller, shipId, sending, skipped } = done;
  if (sending > 0) {
    deps.sendNow();
  }
  await deps.changes.tell({ fleetId: caller.fleetId, shipId });
  return ok({ sending, skipped });
}

/**
 * Takes an entry not to be sent out of the basket; a question its asker
 * withdrew or replaced, still opened, is done as such, as when the person
 * looks at it (section 9).
 */
export async function takeOutUnsent(deps: BasketDeps & DealDeps, taken: { caller: PersonCaller; basket: StandingBasket; entry: BasketEntry; standing: BasketStanding }): Promise<void> {
  const { caller, basket, entry, standing } = taken;
  await deps.entries.remove(entry.fleetId, { shipId: entry.shipId, questionId: entry.questionId });
  const looked = basket.opened.find(({ deliveryId }) => deliveryId === entry.deliveryId);
  if (looked !== undefined && (standing.kind === 'withdrawn' || standing.kind === 'replaced')) {
    await doneIfStale(deps, { caller, crew: basket.crew, looked, waiting: basket.waiting, place: 'bridge' });
  }
}
