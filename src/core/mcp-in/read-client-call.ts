import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ClientCalls } from './ports.js';

/** A call as its client reads it (interop 3.4). Sent and not yet answered, it is submitted. */
export interface ReadCall {
  handle: string;
  state: 'submitted';
}

export type ReadClientCall = (caller: { fleetId: FleetId; party: string }, handle: string) => Promise<Result<ReadCall, DomainError<'NO_SUCH_CALL'>>>;

/** Use case: an outside client reads its own call by the handle it was answered; no other party's. */
export function createReadClientCall(deps: { calls: ClientCalls }): ReadClientCall {
  return async ({ fleetId, party }, handle) => {
    const call = await deps.calls.findByHandle({ fleetId, party }, handle);
    return call ? ok({ handle: call.handle, state: 'submitted' }) : refuse('NO_SUCH_CALL', 'This party made no call with that handle');
  };
}
