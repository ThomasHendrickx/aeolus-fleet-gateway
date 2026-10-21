/**
 * An outside party is a party and its protocol (design B, How A2A slots
 * in): the protocol is a tag on every card and the list counts per
 * protocol, so an A2A agent joins as one more kind here.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../src/adapters/trpc/router.js';

/** An outside party as the API lists it. */
export type ListedParty = inferRouterOutputs<GatewayRouter>['parties']['list'][number];

/** Which side an outside party is on: a server the fleet's ships call, or a client that calls them. */
export type Side = 'server' | 'client';

export const PARTY_KINDS: Record<ListedParty['kind'], { protocol: string; side: Side }> = {
  mcpServer: { protocol: 'MCP', side: 'server' },
  mcpClient: { protocol: 'MCP', side: 'client' },
};

export const SIDES: Record<Side, { one: string; many: string }> = {
  server: { one: 'server', many: 'servers' },
  client: { one: 'client', many: 'clients' },
};

/** The tones the design tokens colour a status by. */
export type Tone = 'waiting' | 'active' | 'ok' | 'attention' | 'ended';

/** A proxy ship's state as the console shows a status. */
export const PARTY_STATES: Record<ListedParty['state'], { tone: Tone; label: string }> = {
  commissioning: { tone: 'active', label: 'Commissioning' },
  awaitingCrew: { tone: 'waiting', label: 'Awaiting crew' },
  crewed: { tone: 'ok', label: 'Crewed' },
};

export interface Counts {
  total: number;
  sides: Record<Side, number>;
  protocols: { protocol: string; count: number }[];
}

/** How many outside parties the fleet has, per side and per protocol. */
export function countsOf(parties: readonly Pick<ListedParty, 'kind'>[]): Counts {
  const kinds = parties.map((party) => PARTY_KINDS[party.kind]);
  const protocols = [...new Set(kinds.map((kind) => kind.protocol))];
  return {
    total: parties.length,
    sides: { server: kinds.filter((kind) => kind.side === 'server').length, client: kinds.filter((kind) => kind.side === 'client').length },
    protocols: protocols.map((protocol) => ({ protocol, count: kinds.filter((kind) => kind.protocol === protocol).length })),
  };
}
