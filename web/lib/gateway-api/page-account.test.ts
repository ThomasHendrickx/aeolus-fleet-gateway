import { describe, expect, it } from 'vitest';

import { pageAccountOf } from './page-account';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';

describe('the account a page of the web app shows its fleet as', () => {
  it('is the account signed in, with its scopes in the fleet', () => {
    expect(pageAccountOf({ inView: { kind: 'signedIn', fleetId: FLEET, accountId: 'acc-charlotte', scopes: ['fleet:manage'] } }, `/parties?fleet=${FLEET}`)).toEqual({
      kind: 'signedIn',
      fleetId: FLEET,
      scopes: ['fleet:manage'],
    });
  });

  it('sends a page that names no fleet to the same page in the fleet the account may open, keeping what else it asked', () => {
    expect(pageAccountOf({ inView: { kind: 'goTo', fleetId: FLEET } }, '/outside-parties?kind=server')).toEqual({ kind: 'goTo', location: `/outside-parties?kind=server&fleet=${FLEET}` });
  });

  it('sends an account that may not open the gateway in the fleet to the app it may open there', () => {
    expect(pageAccountOf({ inView: { kind: 'elsewhere', url: 'https://account.aeolus-fleet.dev/' } }, `/parties?fleet=${FLEET}`)).toEqual({ kind: 'goTo', location: 'https://account.aeolus-fleet.dev/' });
  });

  it('sends a browser signed in to no account to sign in, and back to the page it asked for', () => {
    expect(pageAccountOf({ refusal: 'UNAUTHORIZED' }, `/outside-parties/linear?fleet=${FLEET}`)).toEqual({
      kind: 'goTo',
      location: `/sign-in/start?return_to=%2Foutside-parties%2Flinear%3Ffleet%3D${FLEET}`,
    });
  });

  it('says a gateway that is no app at pagasae signs no one in to its pages', () => {
    expect(pageAccountOf({ refusal: 'NOT_FOUND' }, '/parties')).toEqual({ kind: 'noSignIn' });
  });
});
