import { describe, expect, it } from 'vitest';

import { outboundMessageOf } from './agent-message.js';

const IDS = { messageId: 'out-1', taskId: null, contextId: null };

describe('a delivery to an outside A2A agent, as the A2A message the gateway sends it (slice 6)', () => {
  it.each([
    ['text/plain', 'Quote 10 bolts'],
    ['text/markdown; charset=utf-8', '# Quote\n10 bolts'],
  ])('sends %s as one text part with that media type', (contentType, payload) => {
    expect(outboundMessageOf({ contentType, payload }, IDS)).toEqual({ isOk: true, value: { ...IDS, content: { kind: 'parts', parts: [{ kind: 'text', text: payload, mediaType: contentType }] } } });
  });

  it.each(['application/json', 'application/vnd.supplier.order+json'])('sends %s as one data part', (contentType) => {
    expect(outboundMessageOf({ contentType, payload: '{"bolts":10}' }, IDS)).toEqual({ isOk: true, value: { ...IDS, content: { kind: 'parts', parts: [{ kind: 'data', data: { bolts: 10 }, mediaType: contentType }] } } });
  });

  it('sends an application/a2a+json message whole, with the ids the gateway gives it', () => {
    const written = { messageId: 'mine', role: 'ROLE_USER', parts: [{ text: 'hi' }, { url: 'https://files.example/a.pdf', mediaType: 'application/pdf' }] };

    expect(outboundMessageOf({ contentType: 'application/a2a+json', payload: JSON.stringify(written) }, { messageId: 'out-1', taskId: 'task-1', contextId: 'ctx-1' })).toEqual({
      isOk: true,
      value: { messageId: 'out-1', taskId: 'task-1', contextId: 'ctx-1', content: { kind: 'whole', message: written } },
    });
  });

  it('sends any other type as one text part with its media type', () => {
    expect(outboundMessageOf({ contentType: 'application/vnd.aeolus.question+json-like', payload: 'x' }, IDS)).toMatchObject({ isOk: true, value: { content: { parts: [{ kind: 'text', text: 'x' }] } } });
    expect(outboundMessageOf({ contentType: 'image/svg+xml', payload: '<svg/>' }, IDS)).toMatchObject({ isOk: true, value: { content: { parts: [{ kind: 'text', text: '<svg/>', mediaType: 'image/svg+xml' }] } } });
  });

  it('carries the task and context a follow-up continues', () => {
    expect(outboundMessageOf({ contentType: 'text/plain', payload: 'yes' }, { messageId: 'out-2', taskId: 'task-1', contextId: 'ctx-1' })).toMatchObject({ isOk: true, value: { taskId: 'task-1', contextId: 'ctx-1' } });
  });

  it.each([
    ['JSON that does not parse', 'application/json', '{bolts'],
    ['an A2A message that does not parse', 'application/a2a+json', 'not json'],
    ['an A2A message that is no JSON object', 'application/a2a+json', '[1,2]'],
  ])('refuses %s, saying why', (_case, contentType, payload) => {
    expect(outboundMessageOf({ contentType, payload }, IDS)).toMatchObject({ isOk: false, error: { kind: 'NOT_A_MESSAGE' } });
  });
});
