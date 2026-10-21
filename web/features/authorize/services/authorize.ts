/**
 * What the authorize pages work out: the time a request waiting for
 * approval has left, why a browser got nowhere connecting an MCP client,
 * and the authorization request the pick page carries on to the sign-in.
 */
import type { SearchParams } from '../../../lib/gateway-api/page-api';

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** The time a request has left, in days and hours, as the waiting page's ring shows it. */
export function timeLeft(expiresAt: Date, now: Date): string {
  const hours = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / MS_PER_HOUR));
  return `${String(Math.floor(hours / HOURS_PER_DAY))} d ${String(hours % HOURS_PER_DAY)} h`;
}

const START_AGAIN = 'Start again from your MCP client.';

/** Why a browser got nowhere, as the gateway's authorize doors name it (src/adapters/http/oauth-routes.ts). */
const REASONS: Record<string, string> = {
  invalidClient: `The gateway does not know this MCP client, or the address it asks to be sent back to. ${START_AGAIN}`,
  noPick: 'Pick on the page whether to sign in as yourself or to ask for access for the client.',
  unknownSignIn: `This sign-in is unknown, or took over 10 minutes. ${START_AGAIN}`,
  otherBrowser: `This sign-in was started in another browser, so it is not yours to finish. ${START_AGAIN}`,
  fleetNotServed: 'This gateway does not serve the fleet you signed in to.',
  outsidePartiesOff: "Your fleet's outside parties are off, so no MCP client can ask for access. Sign in as yourself instead, or ask whoever runs your fleet.",
  pagasaeRefused: `The sign-in service did not sign you in. ${START_AGAIN}`,
  unknownWaiting: `This request is unknown, or ended long ago. ${START_AGAIN}`,
  otherBrowserWaiting: `This request was made in another browser, so it is not yours to follow. ${START_AGAIN}`,
  noSignIn: 'This gateway signs no one in, so no MCP client can connect to it: its operator sets pagasae first.',
};

const UNKNOWN_REASON = `The connection did not go through. ${START_AGAIN}`;

export function failedReasonText(reason: string | undefined): string {
  return (reason === undefined ? undefined : REASONS[reason]) ?? UNKNOWN_REASON;
}

/** The pick the page adds to the request, as the sign-in door reads it. */
export const HOLDER_FIELD = 'holder';

/** The request's parameters the browser sent once each, without a pick: the page adds its own. */
export function pickFieldsOf(searchParams: SearchParams): [string, string][] {
  return Object.entries(searchParams).flatMap(([name, value]) => (typeof value === 'string' && name !== HOLDER_FIELD ? [[name, value]] : []));
}
