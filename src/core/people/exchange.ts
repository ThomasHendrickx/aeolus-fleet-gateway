import type { FleetRefusal } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Err } from '../shared/result.js';

/** A page of an exchange or of the list of exchanges: what one screen shows (performance, a page that fits it). */
export const EXCHANGE_PAGE_SIZE = 20;

export type ExchangeRefusal = DomainError<'NO_SUCH_SHIP' | 'NO_SUCH_MESSAGE' | 'FLEET_UNAVAILABLE'>;

/** What the fleet's refusal of an exchange call means to the person: a ship or a message that is not there, or the fleet not answering, with nothing lost. */
export function exchangeRefusalOf(refusal: FleetRefusal, doing: string): Err<ExchangeRefusal> {
  switch (refusal.code) {
    case 'SHIP_NOT_FOUND':
      return refuse('NO_SUCH_SHIP', 'No such ship in this fleet: read your exchanges again');
    case 'MESSAGE_NOT_FOUND':
      return refuse('NO_SUCH_MESSAGE', 'No such message in this exchange: read the exchange again');
    default:
      return refuse('FLEET_UNAVAILABLE', `${doing} now: ${refusal.message}. Nothing is lost`);
  }
}
