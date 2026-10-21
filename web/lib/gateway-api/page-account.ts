/**
 * What a page of the web app does with the API's account.inView (header
 * design H5, H9): show its fleet as the account signed in, or send the
 * browser where it may go: the same page in the fleet the account may open,
 * the app it may open there, or sign-in and back to the page.
 */

/** The API's answer to account.inView. */
export type InView =
  | { kind: 'signedIn'; fleetId: string; accountId: string; scopes: string[] }
  | { kind: 'goTo'; fleetId: string }
  | { kind: 'elsewhere'; url: string };

/** The API's refusals of account.inView a page answers: signed in to no account, and no shared sign-in at this gateway. */
export type InViewRefusal = 'UNAUTHORIZED' | 'NOT_FOUND';

export type PageAccount = { kind: 'signedIn'; fleetId: string; scopes: readonly string[] } | { kind: 'goTo'; location: string } | { kind: 'noSignIn' };

const SIGN_IN_START = '/sign-in/start';

/** The parameter a page names its fleet by. */
export const FLEET_PARAMETER = 'fleet';

/** A page of the web app in a fleet: every link keeps the fleet in its address. */
export function inFleet(page: string, fleetId: string): string {
  const [path = '', query = ''] = page.split('?');
  const parameters = new URLSearchParams(query);
  parameters.set(FLEET_PARAMETER, fleetId);
  return `${path}?${parameters.toString()}`;
}

/** Reads the answer for the page asked for, its path and query as the browser sent them. */
export function pageAccountOf(read: { inView: InView } | { refusal: InViewRefusal }, page: string): PageAccount {
  if ('refusal' in read) {
    return read.refusal === 'UNAUTHORIZED' ? { kind: 'goTo', location: `${SIGN_IN_START}?${new URLSearchParams({ return_to: page }).toString()}` } : { kind: 'noSignIn' };
  }
  const { inView } = read;
  switch (inView.kind) {
    case 'signedIn':
      return { kind: 'signedIn', fleetId: inView.fleetId, scopes: inView.scopes };
    case 'goTo':
      return { kind: 'goTo', location: inFleet(page, inView.fleetId) };
    case 'elsewhere':
      return { kind: 'goTo', location: inView.url };
  }
}
