import { createHmac } from 'node:crypto';

import type { AgentKeys } from '../../core/a2a-out/ports.js';

/** Each derivation under its own label, so a reply key is never also a messageId. */
const MESSAGE_LABEL = 'a2a-message';
const REPLY_LABEL = 'a2a-reply';

/** The ids of A2A out as an HMAC under the gateway's secret, of the parts as a JSON array so no part runs into the next. */
export function createAgentKeys(secret: string): AgentKeys {
  const derived = (parts: string[]) => createHmac('sha256', secret).update(JSON.stringify(parts)).digest('base64url');
  return {
    messageIdOf: (fleetId, messageId) => derived([MESSAGE_LABEL, fleetId, messageId]),
    replyKeyOf: (fleetId, { taskId, event }) => derived([REPLY_LABEL, fleetId, taskId, event]),
  };
}
