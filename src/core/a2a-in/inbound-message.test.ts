import { describe, expect, it } from 'vitest';

import type { Capability } from '../mcp-in/ports.js';
import { capabilityFor, contentOf, type InboundMessage } from './inbound-message.js';

function aMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { messageId: 'm-1', parts: [{ kind: 'text', text: 'Quote 40 chairs.' }], asJson: '{"messageId":"m-1"}', ...overrides };
}

describe('the content type an inbound A2A message travels as (decision 0060)', () => {
  it('sends one text part as its text, plain text when it names no media type', () => {
    expect(contentOf(aMessage())).toEqual({ contentType: 'text/plain', payload: 'Quote 40 chairs.' });
  });

  it("sends one text part with its own media type", () => {
    expect(contentOf(aMessage({ parts: [{ kind: 'text', text: '# Quote', mediaType: 'text/markdown' }] }))).toEqual({ contentType: 'text/markdown', payload: '# Quote' });
  });

  it('sends one data part as JSON, application/json when it names no media type', () => {
    expect(contentOf(aMessage({ parts: [{ kind: 'data', data: { chairs: 40 } }] }))).toEqual({ contentType: 'application/json', payload: '{"chairs":40}' });
  });

  it('sends one data part with its own media type', () => {
    expect(contentOf(aMessage({ parts: [{ kind: 'data', data: { chairs: 40 }, mediaType: 'application/vnd.acme.order+json' }] }))).toEqual({ contentType: 'application/vnd.acme.order+json', payload: '{"chairs":40}' });
  });

  it.each([
    ['two parts', [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }]],
    ['a file part', [{ kind: 'other' }]],
    ['no part', []],
  ] as const)('sends anything else, such as %s, as the whole message in A2A JSON', (_case, parts) => {
    expect(contentOf(aMessage({ parts: [...parts] }))).toEqual({ contentType: 'application/a2a+json', payload: '{"messageId":"m-1"}' });
  });
});

describe('the capability an inbound A2A message calls (decision 0060)', () => {
  const quote: Capability = { name: 'quote', inputModes: ['text/plain', 'application/json'] };
  const order: Capability = { name: 'order', inputModes: ['application/json'] };
  const untyped: Capability = { name: 'untyped' };

  it('is the first capability whose first input mode equals the content type', () => {
    expect(capabilityFor([untyped, order, quote], 'application/json')?.name).toBe('order');
  });

  it('compares media types without regard to case or spaces around parameters', () => {
    expect(capabilityFor([{ name: 'md', inputModes: ['Text/Markdown; charset=utf-8'] }], 'text/markdown;charset=UTF-8')?.name).toBe('md');
  });

  it('is none when no first input mode equals it', () => {
    expect(capabilityFor([quote, order], 'text/markdown')).toBeUndefined();
  });
});
