import type { AgentCard, AgentInterface } from './ports.js';

/** The bindings the gateway calls an agent over, at A2A 1.0 (A11). */
const CALLED_BINDINGS: ReadonlySet<string> = new Set(['JSONRPC', 'HTTP+JSON']);
const CALLED_VERSION = /^1\.0(\.\d+)?$/;

/** Where the gateway calls an outside A2A agent (slice 6): one of its card's interfaces, and whether the card states streaming. */
export interface AgentEndpoint {
  readonly url: string;
  readonly protocolBinding: string;
  readonly isStreaming: boolean;
}

export const isCalledInterface = (each: AgentInterface) => CALLED_BINDINGS.has(each.protocolBinding) && CALLED_VERSION.test(each.protocolVersion);

/** The first interface in the card's order that the gateway calls, as the card prefers it; none when it has none. */
export function agentEndpointOf(card: AgentCard): AgentEndpoint | undefined {
  const called = card.supportedInterfaces.find(isCalledInterface);
  return called === undefined ? undefined : { url: called.url, protocolBinding: called.protocolBinding, isStreaming: card.isStreaming };
}
