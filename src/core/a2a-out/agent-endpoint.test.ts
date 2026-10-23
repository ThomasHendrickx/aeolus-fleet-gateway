import { describe, expect, it } from 'vitest';

import { anAgentCard } from '../../../test/support/a2a-agent-fakes.js';
import { agentEndpointOf } from './agent-endpoint.js';

describe('where the gateway calls an outside A2A agent, from its card (slice 6)', () => {
  it("takes the first interface in the card's order that the gateway calls, saying whether the card streams", () => {
    const card = anAgentCard({
      supportedInterfaces: [
        { url: 'https://agent.example/grpc', protocolBinding: 'GRPC', protocolVersion: '1.0' },
        { url: 'https://agent.example/rest', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
        { url: 'https://agent.example/rpc', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      ],
      isStreaming: true,
    });

    expect(agentEndpointOf(card)).toEqual({ url: 'https://agent.example/rest', protocolBinding: 'HTTP+JSON', isStreaming: true });
  });

  it('passes over an interface at another A2A version', () => {
    const card = anAgentCard({
      supportedInterfaces: [
        { url: 'https://agent.example/old', protocolBinding: 'JSONRPC', protocolVersion: '0.3' },
        { url: 'https://agent.example/rpc', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      ],
    });

    expect(agentEndpointOf(card)).toEqual({ url: 'https://agent.example/rpc', protocolBinding: 'JSONRPC', isStreaming: false });
  });

  it('answers none for a card with no interface the gateway calls', () => {
    expect(agentEndpointOf(anAgentCard({ supportedInterfaces: [{ url: 'https://agent.example/grpc', protocolBinding: 'GRPC', protocolVersion: '1.0' }] }))).toBeUndefined();
  });
});
