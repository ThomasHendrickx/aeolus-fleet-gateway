import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { err, ok } from '../shared/result.js';
import { createAuthenticateOperator } from './authenticate-operator.js';
import type { ConsoleSessions } from './ports.js';

const OPERATOR_COOKIE = 'aeolus_session=operator';
const VIEWER_COOKIE = 'aeolus_session=viewer';
const ACCOUNT_COOKIE = 'aeolus_session=account';

/** A fleet that knows one operator session and one viewer session. */
const sessions: ConsoleSessions = {
  check: (cookie) => {
    const fleetId: FleetId = FLEET_ID;
    if (cookie === OPERATOR_COOKIE) {
      return Promise.resolve(ok({ fleetId, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage'] }));
    }
    if (cookie === VIEWER_COOKIE) {
      return Promise.resolve(ok({ fleetId, kind: 'viewer' as const, scopes: ['fleet:read'] }));
    }
    if (cookie === ACCOUNT_COOKIE) {
      return Promise.resolve(ok({ fleetId, kind: 'account' as const, scopes: ['fleet:read'] }));
    }
    return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Sign in again' }));
  },
};

const authenticate = createAuthenticateOperator({ sessions });

describe('whether a request comes from argo (console.session, decision 0043)', () => {
  it("lets argo's session through as the operator of its fleet", async () => {
    await expect(authenticate(OPERATOR_COOKIE)).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, kind: 'operator', scopes: ['fleet:read', 'fleet:manage'] } });
  });

  it("lets a viewer's session through as a viewer, with the viewer's scopes", async () => {
    await expect(authenticate(VIEWER_COOKIE)).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, kind: 'viewer', scopes: ['fleet:read'] } });
  });

  it("refuses an account's session: an account reaches the gateway by its sign-in, not as argo", async () => {
    await expect(authenticate(ACCOUNT_COOKIE)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR' } });
  });

  it('refuses a request without a session cookie', async () => {
    await expect(authenticate(undefined)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR' } });
  });

  it('refuses a session the fleet does not know', async () => {
    await expect(authenticate('aeolus_session=forged')).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR' } });
  });
});
