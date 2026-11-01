import { ANSWER_CONTENT_TYPE, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { answerKeyOf, answerOf, askingOfEntry, type BasketEntries, type BasketEntry } from './basket.js';
import type { ItemOutcomes } from './item-outcome.js';
import { sightingOf } from './opened-of.js';
import { isEndedCrew, KEY_UNAVAILABLE } from './person-crew.js';
import type { InboxChanges, OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingOn } from './read-inbox.js';
import { askingOf, staleOf, type Asking } from './stale-item.js';

/** What a round did: answers the fleet stored, kept sending for the next round, and refused. */
export type SendStoredAnswers = () => Promise<{ sent: number; kept: number; refused: number }>;

/** How many person ships a round reads at a time. */
const SHIPS_PAGE = 100;

/**
 * The fleet's codes for a call it did not answer, or could not take now: the
 * answer may have been stored or not, so it is sent again under its key.
 */
const NOT_ANSWERED = new Set(['UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'INTERNAL_SERVER_ERROR', KEY_UNAVAILABLE]);

function isNotAnswered(refusal: FleetRefusal): boolean {
  return NOT_ANSWERED.has(refusal.code) || isEndedCrew(refusal);
}

/** What came of one entry: stored, kept sending, refused; answered elsewhere and out; or its question withdrawn or replaced, so put back to wait. */
type Sent = 'sent' | 'kept' | 'refused' | 'dealtElsewhere' | 'stale';

/**
 * Why the fleet refused an answer, in words, as the basket says it after
 * Not sent: such as commercial was retired, so it cannot receive an answer.
 * Core's ship contract answers a ship it cannot address, a retired one, as
 * NOT_FOUND, and one the network rules do not let the person reach as
 * FORBIDDEN.
 */
function refusalTextOf(asker: string, refusal: FleetRefusal): string {
  switch (refusal.code) {
    case 'NOT_FOUND':
      return `${asker} was retired, so it cannot receive an answer`;
    case 'FORBIDDEN':
      return `you may not reach ${asker}`;
    default:
      return `${asker} did not take the answer: ${refusal.message}`;
  }
}

interface SendDeps {
  entries: BasketEntries;
  crews: Pick<PersonCrews, 'find'>;
  door: Pick<PersonShipDoor, 'inbox' | 'pushReceive' | 'reply' | 'handled'>;
  opened: OpenedDeliveries;
  outcomes: ItemOutcomes;
  changes: InboxChanges;
  clock: Clock;
}

/**
 * Use case: the gateway sends what the basket stores as sending (section 9,
 * rule 3), each person ship's entries on its own, in the order added, as
 * the person ship's crew: an answer in reply to its question, under the
 * question's key, so however often it is sent, the fleet stores it once. Each
 * the fleet stored is reported handled, kept answered in Bridge, and stays
 * in the basket as sent, with when; one the fleet did not answer stays
 * sending for the next round, marked so;
 * one it refused stays in the basket, not sent, saying why. A question
 * answered elsewhere first, or handled before a stop, is sent nothing. It
 * runs at every round and after a restart: what was stored as sending goes
 * on with the same keys, so nothing is lost and nothing is sent twice.
 */
export function createSendStoredAnswers(deps: SendDeps): SendStoredAnswers {
  return async () => {
    const counted = { sent: 0, kept: 0, refused: 0 };
    let after: { fleetId: FleetId; shipId: ShipId } | null = null;
    for (;;) {
      const ships = await deps.entries.sendingShips({ after, limit: SHIPS_PAGE });
      for (const ship of ships) {
        for (const sent of await sendShip(deps, ship)) {
          if (sent !== 'dealtElsewhere' && sent !== 'stale') {
            counted[sent] += 1;
          }
        }
      }
      const last = ships.at(-1);
      if (last === undefined || ships.length < SHIPS_PAGE) {
        return counted;
      }
      after = last;
    }
  };
}

/**
 * Sends one person ship's entries stored as sending, in the order added, and
 * tells its pages when any changed. Each is checked at send time
 * (aeolus-fleet#1550): one whose question its asker withdrew or replaced is
 * not sent and goes back to wait, so the basket shows it as such; while the
 * fleet does not answer what waits, each stays sending, marked not answered.
 */
async function sendShip(deps: SendDeps, ship: { fleetId: FleetId; shipId: ShipId }): Promise<Sent[]> {
  const sending = (await deps.entries.list(ship.fleetId, ship.shipId)).filter(({ state }) => state === 'sending');
  const crew = await deps.crews.find(ship.fleetId, ship.shipId);
  if (crew === undefined) {
    return sending.map(() => 'kept');
  }
  const waiting = await waitingOn(deps.door, crew.crewToken);
  if (!waiting.isOk) {
    for (const entry of sending) {
      await keepUnanswered(deps, entry);
    }
    await deps.changes.tell(ship);
    return sending.map(() => 'kept');
  }
  const [outcomes, opened] = await Promise.all([deps.outcomes.findMany(ship.fleetId, { shipId: ship.shipId, deliveryIds: sending.map(({ deliveryId }) => deliveryId) }), deps.opened.list(ship.fleetId, ship.shipId)]);
  const isDealt = new Set<string>(outcomes.map(({ deliveryId }) => deliveryId));
  const among: Asking[] = [...waiting.value.map(askingOf), ...opened];
  const done: Sent[] = [];
  for (const entry of sending) {
    if (isDealt.has(entry.deliveryId)) {
      await takeOut(deps, entry);
      done.push('dealtElsewhere');
    } else if (staleOf(askingOfEntry(entry), among) !== null) {
      await deps.entries.save({ ...entry, state: 'waiting', isUnanswered: false });
      done.push('stale');
    } else {
      done.push(await sendEntry(deps, { crewToken: crew.crewToken, entry }));
    }
  }
  if (done.some((sent) => sent !== 'kept')) {
    await deps.changes.tell(ship);
  }
  return done;
}

/** Keeps an entry sending, marked as one the fleet did not answer, so the person is told it is sent again. */
async function keepUnanswered(deps: SendDeps, entry: BasketEntry): Promise<Sent> {
  if (!entry.isUnanswered) {
    await deps.entries.save({ ...entry, isUnanswered: true });
  }
  return 'kept';
}

/** One answer under its question's key; once stored, reported handled and kept in the basket as sent. */
async function sendEntry(deps: SendDeps, sending: { crewToken: string; entry: BasketEntry }): Promise<Sent> {
  const { crewToken, entry } = sending;
  const replied = await deps.door.reply(crewToken, { to: entry.senderShipId, inReplyTo: entry.messageId, contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify(answerOf(entry)), idempotencyKey: answerKeyOf(entry) });
  if (!replied.isOk && isNotAnswered(replied.error)) {
    return keepUnanswered(deps, entry);
  }
  if (!replied.isOk) {
    await deps.entries.save({ ...entry, state: 'refused', refusal: refusalTextOf(entry.from, replied.error), isUnanswered: false });
    return 'refused';
  }
  const handled = await deps.door.handled(crewToken, entry.deliveryId);
  // Not answered, it is sent again under its key and reported handled at the next round; refused for good, the answer is stored all the same.
  if (!handled.isOk && isNotAnswered(handled.error)) {
    return keepUnanswered(deps, entry);
  }
  const at = deps.clock.now();
  const opened = await deps.opened.find(entry.fleetId, { shipId: entry.shipId, deliveryId: entry.deliveryId });
  await deps.outcomes.save({ fleetId: entry.fleetId, shipId: entry.shipId, deliveryId: entry.deliveryId, place: 'bridge', kind: 'answered', option: entry.option, note: entry.note, seen: opened === undefined ? null : sightingOf(opened), at });
  await deps.opened.remove(entry.fleetId, { shipId: entry.shipId, deliveryId: entry.deliveryId });
  await deps.entries.save({ ...entry, state: 'sent', isUnanswered: false, storedAt: at });
  return 'sent';
}

/** Takes an entry out of the basket with the opened question it answers, which nothing waits on any more. */
async function takeOut(deps: SendDeps, entry: BasketEntry): Promise<void> {
  await deps.opened.remove(entry.fleetId, { shipId: entry.shipId, deliveryId: entry.deliveryId });
  await deps.entries.remove(entry.fleetId, { shipId: entry.shipId, questionId: entry.questionId });
}
