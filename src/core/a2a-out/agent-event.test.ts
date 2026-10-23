import { describe, expect, it } from 'vitest';

import { endsFollowing, replyContentOf, type AgentEvent } from './agent-event.js';

const status = (state: Extract<AgentEvent, { kind: 'status' }>['state']): AgentEvent => ({ kind: 'status', state, json: `{"statusUpdate":{"status":{"state":"${state}"}}}` });

describe("an outside A2A agent's event, as the reply its sender gets (slice 6, 2a)", () => {
  it("replies an artifact of one text part as that text, with its media type, so a ship that knows no A2A reads it", () => {
    expect(replyContentOf({ kind: 'artifact', parts: [{ kind: 'text', text: '10 bolts: 4 EUR', mediaType: 'text/plain' }], json: '{}' })).toEqual({ contentType: 'text/plain', payload: '10 bolts: 4 EUR' });
  });

  it('replies an artifact of one data part as application/json', () => {
    expect(replyContentOf({ kind: 'artifact', parts: [{ kind: 'data', data: { price: 4 }, mediaType: 'application/vnd.supplier.quote+json' }], json: '{}' })).toEqual({ contentType: 'application/json', payload: '{"price":4}' });
  });

  it('replies a message answer of one text part as that text', () => {
    expect(replyContentOf({ kind: 'message', parts: [{ kind: 'text', text: 'Done', mediaType: 'text/markdown' }], json: '{}' })).toEqual({ contentType: 'text/markdown', payload: 'Done' });
  });

  it.each([
    ['an artifact of two parts', { kind: 'artifact', parts: [{ kind: 'text', text: 'a', mediaType: 'text/plain' }, { kind: 'text', text: 'b', mediaType: 'text/plain' }], json: '{"artifactUpdate":{}}' }],
    ['an artifact of a file part', { kind: 'artifact', parts: [{ kind: 'other' }], json: '{"artifactUpdate":{}}' }],
    ['a status', { kind: 'status', state: 'working', json: '{"artifactUpdate":{}}' }],
  ] satisfies [string, AgentEvent][])('replies %s as application/a2a+json, the event as StreamResponse JSON', (_case, event) => {
    expect(replyContentOf(event)).toEqual({ contentType: 'application/a2a+json', payload: event.json });
  });

  it('replies an event too large for a message as text saying so', () => {
    const reply = replyContentOf({ kind: 'artifact', parts: [{ kind: 'text', text: 'x'.repeat(70_000), mediaType: 'text/plain' }], json: '{}' });

    expect(reply.contentType).toBe('text/plain');
    expect(reply.payload).toContain('over the 65536');
  });

  it.each(['completed', 'failed', 'canceled', 'rejected', 'inputRequired', 'authRequired'] as const)('stops following at %s', (state) => {
    expect(endsFollowing(status(state))).toBe(true);
  });

  it.each(['submitted', 'working'] as const)('follows on at %s', (state) => {
    expect(endsFollowing(status(state))).toBe(false);
  });

  it('stops at a message answer, and follows on past an artifact', () => {
    expect([endsFollowing({ kind: 'message', parts: [], json: '{}' }), endsFollowing({ kind: 'artifact', parts: [], json: '{}' })]).toEqual([true, false]);
  });
});
