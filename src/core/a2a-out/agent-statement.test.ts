import { describe, expect, it } from 'vitest';

import { agentStatementOf } from './agent-statement.js';
import type { AgentCard, AgentSkill } from './ports.js';

const TIMING = { waitMs: 10_000, deadlineMs: 300_000 };

const QUOTE: AgentSkill = { id: 'quote', name: 'Quote a price', description: 'Answers a price for a part list.', inputModes: [], outputModes: [] };

function aCard(change: Partial<AgentCard> = {}): AgentCard {
  return {
    name: 'Supplier agent',
    description: 'Quotes and books parts.',
    supportedInterfaces: [{ url: 'https://agent.supplier.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    skills: [QUOTE],
    ...change,
  };
}

const stated = (card: AgentCard, isRepeatable = true) => agentStatementOf({ partyName: 'supplier', card, isRepeatable, timing: TIMING });

describe("an outside A2A agent's statement, written from its card (slice 5)", () => {
  it('states each skill as a capability: its id, name and description, the card default modes, the gateway timing, repeatable', () => {
    expect(stated(aCard())).toEqual({
      isOk: true,
      value: {
        summary: 'supplier, an outside A2A agent reached through the Aeolus gateway: Quotes and books parts.',
        capabilities: [{ name: 'quote', title: 'Quote a price', description: 'Answers a price for a part list.', inputModes: ['text/plain'], outputModes: ['application/json'], waitMs: 10_000, deadlineMs: 300_000, repeatable: true }],
      },
    });
  });

  it("takes a skill's own modes over the card's defaults", () => {
    const card = aCard({ skills: [{ ...QUOTE, inputModes: ['application/json'], outputModes: ['text/csv', 'application/json'] }] });

    expect(stated(card)).toMatchObject({ isOk: true, value: { capabilities: [{ inputModes: ['application/json'], outputModes: ['text/csv', 'application/json'] }] } });
  });

  it('states no capability repeatable once the agent is marked not repeatable (A9)', () => {
    const statement = stated(aCard(), false);

    expect(statement.isOk && statement.value.capabilities[0]).not.toHaveProperty('repeatable');
  });

  it('carries no interface, scheme or signature of the card, and no schema', () => {
    const statement = stated(aCard());

    expect(JSON.stringify(statement)).not.toContain('agent.supplier.example');
    expect(statement.isOk && statement.value.capabilities[0]).not.toHaveProperty('inputSchema');
  });

  it('cuts a long description so the summary keeps to 1000 characters', () => {
    const statement = stated(aCard({ description: 'x'.repeat(2_000) }));

    expect(statement.isOk && statement.value.summary.length).toBe(1_000);
  });

  it.each([
    ['JSON-RPC at 1.0', [{ url: 'https://a.example', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]],
    ['HTTP+JSON at 1.0', [{ url: 'https://a.example', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }]],
    ['gRPC beside JSON-RPC', [{ url: 'https://a.example', protocolBinding: 'GRPC', protocolVersion: '1.0' }, { url: 'https://a.example', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]],
  ])('takes a card with an interface the gateway calls: %s', (_case, supportedInterfaces) => {
    expect(stated(aCard({ supportedInterfaces }))).toMatchObject({ isOk: true });
  });

  it.each([
    ['no interface', aCard({ supportedInterfaces: [] }), 'no interface the gateway calls'],
    ['only gRPC', aCard({ supportedInterfaces: [{ url: 'https://a.example', protocolBinding: 'GRPC', protocolVersion: '1.0' }] }), 'no interface the gateway calls'],
    ['only A2A 0.3', aCard({ supportedInterfaces: [{ url: 'https://a.example', protocolBinding: 'JSONRPC', protocolVersion: '0.3' }] }), 'no interface the gateway calls'],
    ['no skill', aCard({ skills: [] }), 'no skill'],
    ['a skill id that is no capability name', aCard({ skills: [{ ...QUOTE, id: 'quote a price' }] }), 'capability name'],
    ['a skill id over 128 characters', aCard({ skills: [{ ...QUOTE, id: 'q'.repeat(129) }] }), 'capability name'],
    ['two skills with one id', aCard({ skills: [QUOTE, { ...QUOTE, name: 'Quote again' }] }), 'each capability once'],
    ['no mode for a skill', aCard({ defaultInputModes: [] }), 'media type'],
    ['a statement over 64 KB', aCard({ skills: Array.from({ length: 40 }, (_, at) => ({ ...QUOTE, id: `quote-${String(at)}`, description: 'd'.repeat(2_000) })) }), '64 KB'],
  ])('refuses a card with %s, saying why', (_case, card, reason) => {
    expect(stated(card)).toMatchObject({ isOk: false, error: { kind: 'CARD_INVALID', message: expect.stringContaining(reason) as unknown } });
  });

  it('takes a skill id of exactly 128 characters', () => {
    expect(stated(aCard({ skills: [{ ...QUOTE, id: 'q'.repeat(128) }] }))).toMatchObject({ isOk: true });
  });
});
