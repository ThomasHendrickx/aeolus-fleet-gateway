import { createHmac, randomUUID } from 'node:crypto';

import type { CallKeys } from '../../core/mcp-in/ports.js';

/** Each derivation under its own label, so a key is never also a handle. */
const IDEMPOTENCY_LABEL = 'idempotency-key';
const HANDLE_LABEL = 'handle';

/**
 * Keys as an HMAC under the gateway's secret, of the parts as a JSON array so
 * no part's colon or comma runs into the next. A client's key is never sent
 * as it is, and a handle tells nothing of the message id.
 */
export function createCallKeys(secret: string): CallKeys {
  const derived = (parts: string[]) => createHmac('sha256', secret).update(JSON.stringify(parts)).digest('base64url');
  return {
    idempotencyKeyOf: ({ fleetId, party, key }) => derived([IDEMPOTENCY_LABEL, fleetId, party, key]),
    newIdempotencyKey: () => randomUUID(),
    handleOf: (fleetId, messageId) => derived([HANDLE_LABEL, fleetId, messageId]),
  };
}
