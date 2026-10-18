import { err, type Err } from './result.js';

/** Every reason the gateway's core refuses a request. */
export type DomainErrorKind =
  | 'ALREADY_CONNECTED'
  | 'SECRET_REFUSED'
  | 'OTHER_FLEET'
  | 'MISSING_SCOPES'
  | 'NO_NETWORKING_PLUGIN'
  | 'NOT_THE_OPERATOR'
  | 'REQUEST_ID_USED'
  | 'FLEET_UNAVAILABLE'
  | 'NOT_CONNECTED'
  | 'PARTY_EXISTS'
  | 'COMMISSION_REFUSED';

/** Why the core refused a request. Adapters map the kind to their own error shape; the message is safe to show. */
export interface DomainError<K extends DomainErrorKind = DomainErrorKind> {
  readonly kind: K;
  readonly message: string;
}

/** A refusal: the error result of the given kind. */
export function refuse<K extends DomainErrorKind>(kind: K, message: string): Err<DomainError<K>> {
  return err({ kind, message });
}
