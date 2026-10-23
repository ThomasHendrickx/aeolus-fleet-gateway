import { describe, expect, it } from 'vitest';

import { createAgentKeys } from './agent-keys.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MESSAGE = 'msg_01m3tbfspe96yf1rnr4ank9m01';

describe('the ids of a message to an outside A2A agent and of its replies, derived under the gateway secret (slice 6)', () => {
  it("derives the agent's messageId from the fleet and the message: the same for the same, telling nothing of the message id", () => {
    const keys = createAgentKeys(SECRET);

    expect(keys.messageIdOf(FLEET, MESSAGE)).toBe(keys.messageIdOf(FLEET, MESSAGE));
    expect(keys.messageIdOf(OTHER_FLEET, MESSAGE)).not.toBe(keys.messageIdOf(FLEET, MESSAGE));
    expect(keys.messageIdOf(FLEET, MESSAGE)).not.toContain('01m3tbfspe96yf1rnr4ank9m01');
  });

  it('derives one reply key for the same event of the same task, another for any other', () => {
    const keys = createAgentKeys(SECRET);
    const derived = [
      keys.replyKeyOf(FLEET, { taskId: 'task-1', event: '{"statusUpdate":{}}' }),
      keys.replyKeyOf(FLEET, { taskId: 'task-1', event: '{"statusUpdate":{}}' }),
      keys.replyKeyOf(FLEET, { taskId: 'task-2', event: '{"statusUpdate":{}}' }),
      keys.replyKeyOf(FLEET, { taskId: 'task-1', event: '{"artifactUpdate":{}}' }),
      keys.replyKeyOf(OTHER_FLEET, { taskId: 'task-1', event: '{"statusUpdate":{}}' }),
    ];

    expect(new Set(derived).size).toBe(4);
  });

  it('keeps a reply key apart from a messageId of the same parts', () => {
    const keys = createAgentKeys(SECRET);

    expect(keys.replyKeyOf(FLEET, { taskId: MESSAGE, event: '' })).not.toBe(keys.messageIdOf(FLEET, MESSAGE));
  });
});
