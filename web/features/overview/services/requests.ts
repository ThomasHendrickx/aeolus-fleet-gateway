/**
 * How the Overview names and states a request for an outside party (design
 * B, Signal): pure view logic, no React and no API client.
 */
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';

/** A request as the API shows it. */
export type ShownRequest = inferRouterOutputs<GatewayRouter>['requests']['toDecide'][number];

/** The tones a status shows, from the design tokens; a status always has its words too. */
export type Tone = 'waiting' | 'active' | 'ok' | 'attention' | 'ended';

export interface Status {
  readonly tone: Tone;
  readonly label: string;
}

const DAY_MS = 86_400_000;

/** How an outside party is named before it has a proxy ship: a client by its name, a server by its host. */
export function subjectName(request: ShownRequest): string {
  switch (request.subject.kind) {
    case 'client':
      return request.subject.clientName;
    case 'server':
      return URL.canParse(request.subject.url) ? new URL(request.subject.url).host : request.subject.url;
  }
}

export function subjectKind(request: ShownRequest): string {
  switch (request.subject.kind) {
    case 'client':
      return 'MCP client';
    case 'server':
      return 'MCP server';
  }
}

/** Days left of the 7 a request is kept, counted up, so its last day reads as such, in the attention tone. */
export function daysLeft(request: ShownRequest, now: Date): Status {
  const days = Math.ceil((Date.parse(request.expiresAt) - now.getTime()) / DAY_MS);
  return days <= 1 ? { tone: 'attention', label: 'Last day' } : { tone: 'waiting', label: `${String(days)} d left` };
}

/** A request's state as the console shows a status; one still pending shows its days left. */
export function requestStatus(request: ShownRequest, now: Date): Status {
  switch (request.state) {
    case 'pending':
      return daysLeft(request, now);
    case 'approving':
      return { tone: 'active', label: 'Approving' };
    case 'approved':
      return { tone: 'ok', label: 'Approved' };
    case 'denied':
      return { tone: 'ended', label: 'Denied' };
    case 'expired':
      return { tone: 'ended', label: 'Expired' };
  }
}

/** A proxy ship's name offered from the party's own: lower case letters, digits and dashes. */
export function suggestedName(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

/** The scopes every app ship gets (0046): shown locked on, and always sent. */
export const EVERY_APP_SHIP_SCOPES: readonly string[] = ['messages:send', 'messages:receive'];

const SCOPE_LABELS: Record<string, string> = {
  'messages:send': 'Send',
  'messages:receive': 'Receive',
  'fleet:read': 'Read the fleet',
};

/** A scope's plain label, shown beside the scope itself. */
export function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

/** The server's credential as the decision form takes it. */
export interface ServerCredentialInput {
  readonly credentialKind: 'bearer' | 'clientCredentials';
  readonly token: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly issuer: string;
  readonly scope: string;
  readonly concurrencyLimit: number;
}

export type DecisionInput = { readonly kind: 'deny' } | { readonly kind: 'approve'; readonly name: string; readonly ownerShipId: string; readonly scopes: readonly string[]; readonly server: ServerCredentialInput | undefined };
