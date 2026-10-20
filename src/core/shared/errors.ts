import { err, type Err } from './result.js';

/** Every reason the gateway's core refuses a request. */
export type DomainErrorKind =
  | 'ALREADY_CONNECTED'
  | 'SECRET_REFUSED'
  | 'OTHER_FLEET'
  | 'MISSING_SCOPES'
  | 'NO_NETWORKING_PLUGIN'
  | 'SCOPE_REFUSED'
  | 'NOT_THE_OPERATOR'
  | 'NOT_AN_ACTOR'
  | 'REQUEST_ID_USED'
  | 'FLEET_UNAVAILABLE'
  | 'NOT_CONNECTED'
  | 'PARTY_EXISTS'
  | 'COMMISSION_REFUSED'
  | 'NO_SUCH_PARTY'
  | 'NOT_AWAITING_CREW'
  | 'NOT_CREWED'
  | 'SERVER_UNREACHABLE'
  | 'STATEMENT_REFUSED'
  | 'INVALID_REDIRECT_URIS'
  | 'CLIENT_HAS_PARTY'
  | 'PARTY_NOT_CREWED'
  | 'NO_SUCH_TOOL'
  | 'INVALID_ARGUMENTS'
  | 'NOT_REACHABLE'
  | 'SEND_REFUSED'
  | 'NO_SUCH_CALL'
  | 'NOT_A_PERSON'
  | 'SIGNED_OUT'
  | 'NO_SUCH_DELIVERY';

/** Why the core refused a request. Adapters map the kind to their own error shape; the message is safe to show. */
export interface DomainError<K extends DomainErrorKind = DomainErrorKind> {
  readonly kind: K;
  readonly message: string;
}

/** A refusal: the error result of the given kind. */
export function refuse<K extends DomainErrorKind>(kind: K, message: string): Err<DomainError<K>> {
  return err({ kind, message });
}
