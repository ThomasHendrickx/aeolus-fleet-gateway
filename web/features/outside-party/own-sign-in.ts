/**
 * Your own sign-in on a server's page (decision 0067, M2): how a sign-in
 * went, as the address the gateway sends the browser back to says it
 * (src/adapters/http/party-sign-in-routes.ts), or as Remove says it; and
 * when it was made or last used, in words.
 */
import type { SearchParams } from '../../lib/gateway-api/page-api';

/** What the address back says of a sign-in, and what the page calls it. */
const OUTCOMES = {
  'signed-in': 'signedIn',
  removed: 'removed',
  failed: 'failed',
  'turned-away': 'turnedAway',
  'not-signed-in': 'cancelled',
  unavailable: 'unavailable',
} as const;

export type SignInOutcomeKind = (typeof OUTCOMES)[keyof typeof OUTCOMES];

/** How a sign-in went, with the authorization server's error code where it answered one. */
export interface SignInOutcome {
  kind: SignInOutcomeKind;
  serverError: string | null;
}

/** The parameter the address names the outcome by, and the one it names the server's error code by. */
export const SIGN_IN_PARAMETER = 'sign-in';
const ERROR_PARAMETER = 'error';

function isSaid(said: string): said is keyof typeof OUTCOMES {
  return Object.hasOwn(OUTCOMES, said);
}

/** How the sign-in went, or nothing when the address says no outcome it knows. */
export function signInOutcomeOf(searchParams: SearchParams): SignInOutcome | null {
  const said = searchParams[SIGN_IN_PARAMETER];
  if (typeof said !== 'string' || !isSaid(said)) {
    return null;
  }
  const serverError = searchParams[ERROR_PARAMETER];
  return { kind: OUTCOMES[said], serverError: typeof serverError === 'string' ? serverError : null };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The months as the day and time name them. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** When something happened, in words: Just now, minutes ago within the hour, else the day and time in UTC, as the console's other times are. */
export function whenWordsOf(at: string, now: Date): string {
  const time = new Date(at);
  const ago = now.getTime() - time.getTime();
  if (ago < MINUTE_MS) {
    return 'Just now';
  }
  if (ago < HOUR_MS) {
    return `${String(Math.floor(ago / MINUTE_MS))} min ago`;
  }
  return `${String(time.getUTCDate())} ${MONTHS[time.getUTCMonth()] ?? ''}, ${twoDigits(time.getUTCHours())}:${twoDigits(time.getUTCMinutes())}`;
}
