import { describe, expect, it } from 'vitest';

import { eventIdentityOf, endsFollowing, replyContentOf, type AgentEvent } from './agent-event.js';

const status = (state: Extract<AgentEvent, { kind: 'status' }>['state']): AgentEvent => ({ kind: 'status', state, timestamp: null, json: `{"statusUpdate":{"status":{"state":"${state}"}}}` });

describe("an outside A2A agent's event, as the reply its sender gets (slice 6, 2a)", () => {
  it("replies an artifact of one text part as that text, with its media type, so a ship that knows no A2A reads it", () => {
    expect(replyContentOf({ kind: 'artifact', artifactId: 'a-1', isAppended: false, parts: [{ kind: 'text', text: '10 bolts: 4 EUR', mediaType: 'text/plain' }], json: '{}' })).toEqual({ contentType: 'text/plain', payload: '10 bolts: 4 EUR' });
  });

  it('replies an artifact of one data part as application/json', () => {
    expect(replyContentOf({ kind: 'artifact', artifactId: 'a-1', isAppended: false, parts: [{ kind: 'data', data: { price: 4 }, mediaType: 'application/vnd.supplier.quote+json' }], json: '{}' })).toEqual({ contentType: 'application/json', payload: '{"price":4}' });
  });

  it('replies a message answer of one text part as that text', () => {
    expect(replyContentOf({ kind: 'message', messageId: 'm-1', parts: [{ kind: 'text', text: 'Done', mediaType: 'text/markdown' }], json: '{}' })).toEqual({ contentType: 'text/markdown', payload: 'Done' });
  });

  it.each([
    ['an artifact of two parts', { kind: 'artifact', artifactId: 'a-1', isAppended: false, parts: [{ kind: 'text', text: 'a', mediaType: 'text/plain' }, { kind: 'text', text: 'b', mediaType: 'text/plain' }], json: '{"artifactUpdate":{}}' }],
    ['an artifact of a file part', { kind: 'artifact', artifactId: 'a-1', isAppended: false, parts: [{ kind: 'other' }], json: '{"artifactUpdate":{}}' }],
    ['a status', { kind: 'status', state: 'working', timestamp: null, json: '{"artifactUpdate":{}}' }],
  ] satisfies [string, AgentEvent][])('replies %s as application/a2a+json, the event as StreamResponse JSON', (_case, event) => {
    expect(replyContentOf(event)).toEqual({ contentType: 'application/a2a+json', payload: event.json });
  });

  it('replies an event too large for a message as text saying so', () => {
    const reply = replyContentOf({ kind: 'artifact', artifactId: 'a-1', isAppended: false, parts: [{ kind: 'text', text: 'x'.repeat(270_000), mediaType: 'text/plain' }], json: '{}' });

    expect(reply.contentType).toBe('text/plain');
    expect(reply.payload).toContain('over the 262144');
  });

  it.each(['completed', 'failed', 'canceled', 'rejected', 'inputRequired', 'authRequired'] as const)('stops following at %s', (state) => {
    expect(endsFollowing(status(state))).toBe(true);
  });

  it.each(['submitted', 'working'] as const)('follows on at %s', (state) => {
    expect(endsFollowing(status(state))).toBe(false);
  });

  it('stops at a message answer, and follows on past an artifact', () => {
    expect([endsFollowing({ kind: 'message', messageId: 'm-1', parts: [], json: '{}' }), endsFollowing({ kind: 'artifact', artifactId: 'a-1', isAppended: false, parts: [], json: '{}' })]).toEqual([true, false]);
  });
});

describe("an event's identity, what makes it one reply (slice 6)", () => {
  const working = (timestamp: string | null): AgentEvent => ({ kind: 'status', state: 'working', timestamp, json: '{}' });
  const chunk = (isAppended: boolean): AgentEvent => ({ kind: 'artifact', artifactId: 'a-1', isAppended, parts: [], json: String(isAppended) });

  const fresh = { answering: 'msg-1', chunkPlaces: {} };

  it('tells a status apart by its time, and by the message it answers', () => {
    const identityOf = (event: AgentEvent, answering = 'msg-1') => eventIdentityOf(event, { answering, chunkPlaces: {} }).identity;
    const identities = [identityOf(working('2026-10-23T12:00:00Z')), identityOf(working('2026-10-23T12:00:00Z')), identityOf(working('2026-10-23T12:00:05Z')), identityOf(working('2026-10-23T12:00:00Z'), 'msg-2')];

    expect(new Set(identities).size).toBe(3);
  });

  it('gives each appended chunk its own place, and a whole artifact the place of its first chunk', () => {
    const first = eventIdentityOf(chunk(false), fresh);
    const second = eventIdentityOf(chunk(true), { ...fresh, chunkPlaces: first.chunkPlaces });
    const third = eventIdentityOf(chunk(true), { ...fresh, chunkPlaces: second.chunkPlaces });
    const whole = eventIdentityOf(chunk(false), { ...fresh, chunkPlaces: third.chunkPlaces });

    expect({ distinct: new Set([first.identity, second.identity, third.identity]).size, isWholeTheFirst: whole.identity === first.identity, places: whole.chunkPlaces }).toEqual({ distinct: 3, isWholeTheFirst: true, places: { 'a-1': 3 } });
  });
});
