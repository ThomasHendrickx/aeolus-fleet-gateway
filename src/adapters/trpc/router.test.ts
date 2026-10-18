import type { FleetId } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import type { ApproveParty } from '../../core/parties/approve-party.js';
import { ok } from '../../core/shared/result.js';
import { gatewayRouter, type Context } from './router.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9own';
const ARGO_COOKIE = 'aeolus_session=argo';
const VIEWER_COOKIE = 'aeolus_session=viewer';

/** A context with only what the parties procedures read; every approval it is asked for is recorded. */
function aContext(cookie: string): { context: Context; approvals: Parameters<ApproveParty>[0][] } {
  const approvals: Parameters<ApproveParty>[0][] = [];
  const unused = () => Promise.reject(new Error('not used by the parties procedures'));
  const context: Context = {
    cookie,
    authenticateOperator: (sent) =>
      Promise.resolve(ok(sent === ARGO_COOKIE ? { fleetId: FLEET, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage'] } : { fleetId: FLEET, kind: 'viewer' as const, scopes: ['fleet:read'] })),
    isServed: () => Promise.resolve(true),
    heldConnection: unused,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    setFleetEnabled: unused,
    readFleet: unused,
    deleteFleet: unused,
    readConnection: unused,
    connect: unused,
    approveParty: (input) => {
      approvals.push(input);
      return Promise.resolve(ok({ name: input.name, kind: 'mcpServer' as const, url: input.url, credentialKind: input.credential.kind, ownerShipId: input.ownerShipId, concurrencyLimit: input.concurrencyLimit, state: 'crewed' as const, proxyShipId: null }));
    },
    crewParty: unused,
    listParties: () => Promise.resolve([]),
  };
  return { context, approvals };
}

const APPROVAL = { requestId: 'a-1', name: 'crm', url: 'https://crm.example.com/mcp', credential: { kind: 'bearer', token: 'crm-token' }, ownerShipId: OWNER };

describe("argo approves parties through the gateway's API", () => {
  it("approves for argo's fleet, with the default concurrency limit of 4", async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve(APPROVAL);

    expect(approvals).toEqual([{ operatorFleetId: FLEET, ...APPROVAL, concurrencyLimit: 4 }]);
  });

  it('refuses a viewer, who only reads', async () => {
    const { context, approvals } = aContext(VIEWER_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve(APPROVAL)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(approvals).toEqual([]);
  });

  it('lets a viewer read the parties', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.list()).resolves.toEqual([]);
  });

  it.each([
    ['a URL that is not http or https', { ...APPROVAL, url: 'ftp://crm.example.com/mcp' }],
    ['an empty bearer token', { ...APPROVAL, credential: { kind: 'bearer', token: '' } }],
    ['client credentials without an issuer', { ...APPROVAL, credential: { kind: 'clientCredentials', clientId: 'gw', clientSecret: 's' } }],
    ['a concurrency limit of 0', { ...APPROVAL, concurrencyLimit: 0 }],
    ['a concurrency limit of 65', { ...APPROVAL, concurrencyLimit: 65 }],
    ['a name that is no ship handle', { ...APPROVAL, name: 'the CRM' }],
  ])('refuses %s', async (_what, approval) => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve(approval)).rejects.toBeInstanceOf(TRPCError);
    expect(approvals).toEqual([]);
  });

  it('takes a concurrency limit of 64', async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve({ ...APPROVAL, concurrencyLimit: 64 });

    expect(approvals[0]?.concurrencyLimit).toBe(64);
  });
});
