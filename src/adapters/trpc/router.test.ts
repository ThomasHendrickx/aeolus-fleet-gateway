import type { FleetId } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { MarkTool } from '../../core/mcp-out/mark-tool.js';
import type { SetIdentityProvider } from '../../core/federation/set-identity-provider.js';
import type { ApproveParty } from '../../core/parties/approve-party.js';
import { err, ok } from '../../core/shared/result.js';
import { gatewayRouter, type Context } from './router.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const ARGO_COOKIE = 'aeolus_session=argo';
const VIEWER_COOKIE = 'aeolus_session=viewer';
const SET_AT = new Date('2026-10-19T12:00:00.000Z');

/** A context with only what the parties procedures read; every approval it is asked for is recorded. */
function aContext(cookie: string): { context: Context; approvals: Parameters<ApproveParty>[0][]; marks: Parameters<MarkTool>[0][]; providers: Parameters<SetIdentityProvider>[0][] } {
  const approvals: Parameters<ApproveParty>[0][] = [];
  const providers: Parameters<SetIdentityProvider>[0][] = [];
  const marks: Parameters<MarkTool>[0][] = [];
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
    registerClient: (input) => Promise.resolve(input.redirectUris.length === 0 ? err({ kind: 'INVALID_REDIRECT_URIS' as const, message: 'A client registers 1 to 10 redirect URIs' }) : ok({ clientId: 'client-1', clientSecret: input.isConfidential ? 's' : null })),
    stateParty: ({ name }) => Promise.resolve(name === 'crm' ? ok({ capabilities: ['list_deals'] }) : err({ kind: 'NO_SUCH_PARTY' as const, message: `No party named ${name}` })),
    markTool: (input) => {
      marks.push(input);
      return Promise.resolve(ok({ capabilities: ['list_deals'] }));
    },
    setIdentityProvider: (input) => {
      providers.push(input);
      return Promise.resolve(input.issuer.startsWith('https://') ? ok({ issuer: input.issuer, clientId: input.clientId, setAt: SET_AT }) : err({ kind: 'INVALID_ISSUER' as const, message: 'An issuer is an https URL' }));
    },
    readIdentityProvider: () => Promise.resolve({ issuer: 'https://accounts.google.com', clientId: 'gateway', setAt: SET_AT }),
  };
  return { context, approvals, marks, providers };
}

const APPROVAL = { requestId: 'a-1', name: 'crm', url: 'https://crm.example.com/mcp', credential: { kind: 'bearer' as const, token: 'crm-token' }, ownerShipId: OWNER };

type ApprovalInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['parties']['approve']>[0];

/** An input as it arrives over HTTP: anything, for the router's own parsing to judge. */
const asSent = (input: unknown): ApprovalInput => z.custom<ApprovalInput>(() => true).parse(input);

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
    ['a concurrency limit of 11, over the 10 calls core hands a proxy ship at once', { ...APPROVAL, concurrencyLimit: 11 }],
    ['a name that is no ship handle', { ...APPROVAL, name: 'the CRM' }],
  ])('refuses %s', async (_what, approval) => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve(asSent(approval))).rejects.toBeInstanceOf(TRPCError);
    expect(approvals).toEqual([]);
  });

  it('takes a concurrency limit of 10', async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve({ ...APPROVAL, concurrencyLimit: 10 });

    expect(approvals[0]?.concurrencyLimit).toBe(10);
  });
});

type MarkInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['parties']['markTool']>[0];

describe("argo states a party's tools and marks them repeatable through the gateway's API", () => {
  it("states a party's proxy ship, answering its capabilities", async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.state({ name: 'crm' })).resolves.toEqual({ capabilities: ['list_deals'] });
  });

  it('answers NOT_FOUND for a party it does not know', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.state({ name: 'erp' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("marks a tool for argo's fleet", async () => {
    const { context, marks } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.markTool({ name: 'crm', tool: 'create_deal', isRepeatable: true });

    expect(marks).toEqual([{ fleetId: FLEET, name: 'crm', tool: 'create_deal', isRepeatable: true }]);
  });

  it('refuses a viewer a mark or a statement', async () => {
    const { context, marks } = aContext(VIEWER_COOKIE);
    const caller = gatewayRouter.createCaller(context);

    await expect(caller.parties.markTool({ name: 'crm', tool: 'create_deal', isRepeatable: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.parties.state({ name: 'crm' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(marks).toEqual([]);
  });

  it.each([
    ['an empty tool name', ''],
    ['a tool name over 128 characters', 'x'.repeat(129)],
  ])('refuses %s', async (_what, tool) => {
    const { context, marks } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.markTool(z.custom<MarkInput>(() => true).parse({ name: 'crm', tool, isRepeatable: true }))).rejects.toBeInstanceOf(TRPCError);
    expect(marks).toEqual([]);
  });
});

describe('argo pre-registers MCP clients through the gateway\'s API', () => {
  it("registers a client for argo's fleet, answering its secret once", async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], isConfidential: true })).resolves.toEqual({
      clientId: 'client-1',
      clientSecret: 's',
    });
  });

  it('refuses a viewer', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], isConfidential: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers BAD_REQUEST to redirect URIs it refuses', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: [], isConfidential: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe("argo sets the fleet's company identity provider through the gateway's API", () => {
  const GOOGLE = { issuer: 'https://accounts.google.com', clientId: 'gateway', clientSecret: 'google-secret' };

  it("sets it for argo's fleet, answering it without its secret", async () => {
    const { context, providers } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).identityProvider.set(GOOGLE)).resolves.toEqual({ issuer: 'https://accounts.google.com', clientId: 'gateway', setAt: SET_AT.toISOString() });
    expect(providers).toEqual([{ fleetId: FLEET, ...GOOGLE }]);
  });

  it('answers BAD_REQUEST with the reason for one it refuses', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).identityProvider.set({ ...GOOGLE, issuer: 'http://accounts.google.com' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'An issuer is an https URL' });
  });

  it('refuses a viewer, who only reads it', async () => {
    const { context, providers } = aContext(VIEWER_COOKIE);
    const caller = gatewayRouter.createCaller(context);

    await expect(caller.identityProvider.set(GOOGLE)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.identityProvider.get()).resolves.toEqual({ issuer: 'https://accounts.google.com', clientId: 'gateway', setAt: SET_AT.toISOString() });
    expect(providers).toEqual([]);
  });

  it.each([
    { what: 'an empty client id', input: { ...GOOGLE, clientId: '' } },
    { what: 'an empty client secret', input: { ...GOOGLE, clientSecret: '' } },
    { what: 'a field it does not know', input: { ...GOOGLE, tenant: 'x' } },
  ])('refuses $what', async ({ input }) => {
    const { context, providers } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).identityProvider.set(z.custom<typeof GOOGLE>(() => true).parse(input))).rejects.toBeInstanceOf(TRPCError);
    expect(providers).toEqual([]);
  });
});
