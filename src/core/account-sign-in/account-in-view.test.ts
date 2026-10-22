import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { ACCOUNT_URL, CHARLOTTE, CHARLOTTE_ACCOUNT_TOKEN, CHARLOTTE_SIGN_IN, CONSOLE_URL, fakeSharedSignIn } from '../../../test/support/account-sign-in-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { createAccountInView } from './account-in-view.js';
import { createAccountOfSignIn } from './account-of-sign-in.js';
import type { SharedAccountToken } from './ports.js';

// The gateway's pages show the fleet in their address (?fleet=<fleet id>,
// orchestrator-1, 21 Oct), as the account its shared sign-in names there
// (header design H5): pagasae exchanges the sign-in for the account token of
// that fleet, which the gateway keeps until a minute before it ends.

const NOW = new Date('2026-10-21T09:00:00.000Z');

let now: Date;

beforeEach(() => {
  now = NOW;
});

const clock = { now: () => now };

function inView(signIns: ReturnType<typeof fakeSharedSignIn>) {
  return createAccountInView({ signIns, accountOf: createAccountOfSignIn({ signIns, clock }) });
}

const CHARLOTTE_IN_FLEET: ReadonlyMap<FleetId, SharedAccountToken> = new Map([[FLEET_ID, CHARLOTTE_ACCOUNT_TOKEN]]);

describe('the account a page shows the fleet in its address as', () => {
  it('is the account the shared sign-in names there, with the scopes and token pagasae answered', async () => {
    const answer = await inView(fakeSharedSignIn({ tokens: CHARLOTTE_IN_FLEET }))({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });

    expect(answer).toEqual({ isOk: true, value: { kind: 'signedIn', fleetId: FLEET_ID, token: CHARLOTTE_ACCOUNT_TOKEN } });
  });

  it('is nobody without a shared sign-in, so the person signs in', async () => {
    expect(await inView(fakeSharedSignIn({ tokens: CHARLOTTE_IN_FLEET }))({ signIn: undefined, fleetId: FLEET_ID })).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });

  it('is nobody once the shared sign-in ended anywhere', async () => {
    expect(await inView(fakeSharedSignIn({ tokens: CHARLOTTE_IN_FLEET }))({ signIn: 'ended-sign-in', fleetId: FLEET_ID })).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });

  it('says pagasae did not answer, never that the person signed out', async () => {
    expect(await inView(fakeSharedSignIn({ isAvailable: false }))({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID })).toEqual({ isOk: false, error: { kind: 'pagasaeUnavailable' } });
  });

  it('sends an account with no right in the fleet to an app it may open there (H9)', async () => {
    const answer = await inView(fakeSharedSignIn({ tokens: new Map() }))({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });

    expect(answer).toEqual({ isOk: true, value: { kind: 'elsewhere', url: CONSOLE_URL } });
  });

  it('sends an account with nothing to open in the fleet to Account (H9)', async () => {
    const signIns = fakeSharedSignIn({ tokens: new Map(), apps: { account: CHARLOTTE, apps: [{ app: 'account', url: ACCOUNT_URL }], fleets: [] } });

    expect(await inView(signIns)({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID })).toEqual({ isOk: true, value: { kind: 'elsewhere', url: ACCOUNT_URL } });
  });
});

describe('a page asked for with no fleet in its address', () => {
  it('goes to the first fleet whose gateway the account may open', async () => {
    expect(await inView(fakeSharedSignIn({}))({ signIn: CHARLOTTE_SIGN_IN, fleetId: undefined })).toEqual({ isOk: true, value: { kind: 'goTo', fleetId: OTHER_FLEET_ID } });
  });

  it('goes to Account when the account may open no gateway', async () => {
    const signIns = fakeSharedSignIn({ apps: { account: CHARLOTTE, apps: [{ app: 'account', url: ACCOUNT_URL }], fleets: [{ fleetId: FLEET_ID, name: 'Acme', apps: [{ app: 'console', url: CONSOLE_URL }] }] } });

    expect(await inView(signIns)({ signIn: CHARLOTTE_SIGN_IN, fleetId: undefined })).toEqual({ isOk: true, value: { kind: 'elsewhere', url: ACCOUNT_URL } });
  });

  it('is nobody without a shared sign-in', async () => {
    expect(await inView(fakeSharedSignIn({}))({ signIn: undefined, fleetId: undefined })).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });
});

describe('the account token of the fleet in view', () => {
  it('is exchanged once while it lasts, however many calls the pages make', async () => {
    const signIns = fakeSharedSignIn({ tokens: CHARLOTTE_IN_FLEET });
    const accountOf = createAccountOfSignIn({ signIns, clock });

    await accountOf({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });
    now = new Date('2026-10-21T09:08:59.000Z');
    await accountOf({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });

    expect(signIns.exchanges).toBe(1);
  });

  it('is exchanged again a minute before it ends, so a change of rights lands then', async () => {
    const signIns = fakeSharedSignIn({ tokens: CHARLOTTE_IN_FLEET });
    const accountOf = createAccountOfSignIn({ signIns, clock });

    await accountOf({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });
    now = new Date('2026-10-21T09:09:00.000Z');
    await accountOf({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });

    expect(signIns.exchanges).toBe(2);
  });

  it('is never kept when pagasae refused it', async () => {
    const signIns = fakeSharedSignIn({ tokens: new Map() });
    const accountOf = createAccountOfSignIn({ signIns, clock });

    await accountOf({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });
    await accountOf({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });

    expect(signIns.exchanges).toBe(2);
  });

  it('is its own per sign-in, so another browser never acts as it', async () => {
    const signIns = fakeSharedSignIn({ tokens: CHARLOTTE_IN_FLEET });
    const accountOf = createAccountOfSignIn({ signIns, clock });

    await accountOf({ signIn: CHARLOTTE_SIGN_IN, fleetId: FLEET_ID });

    expect(await accountOf({ signIn: 'another-sign-in', fleetId: FLEET_ID })).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });
});
