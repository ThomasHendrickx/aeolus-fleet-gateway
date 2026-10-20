/**
 * The Outside parties page: whether the fleet's outside parties are on, and
 * the switch for an actor holding fleet:network (interop I-3, decision
 * 0056). Turning them on in a fleet with no network rules shows the API's
 * warning, and only a second, confirmed form turns them on. The page calls
 * the gateway's own API as the caller, so it checks nothing the API does
 * not; it shows the switch only to an actor holding its scope and refuses a
 * form sent from another origin.
 */
import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { SWITCHING_SCOPE } from '../../core/outside-parties/set-outside-parties.js';
import type { inferRouterOutputs } from '@trpc/server';

import { gatewayRouter, type Context, type GatewayRouter } from '../trpc/router.js';
import { acceptForms, escaped, isSameOrigin } from './html.js';
import { icon, partyMark, ring, signalPage, signInPrompt, statusBadge, type Icon, type SignInWay, type Tone } from './signal.js';

/** An outside party as the API shows it. */
type ShownParty = inferRouterOutputs<GatewayRouter>['parties']['list'][number];

/** Which side an outside party is on: a server the fleet's ships call, or a client that calls them. */
export type Side = 'server' | 'client';

/**
 * An outside party is a party and its protocol (design B, How A2A slots in):
 * the protocol is a tag on every card and the list counts per protocol, so
 * an A2A agent joins as one more row here.
 */
export const PARTY_KINDS: Record<ShownParty['kind'], { protocol: string; side: Side }> = {
  mcpServer: { protocol: 'MCP', side: 'server' },
  mcpClient: { protocol: 'MCP', side: 'client' },
};

export const SIDES: Record<Side, { icon: Icon; one: string; many: string }> = {
  server: { icon: 'server', one: 'server', many: 'servers' },
  client: { icon: 'laptop', one: 'client', many: 'clients' },
};

/** A proxy ship's state as the console shows a status: tone, icon and label. */
export const PARTY_STATES: Record<ShownParty['state'], { tone: Tone; icon: Icon; label: string }> = {
  commissioning: { tone: 'active', icon: 'hourglass', label: 'Commissioning' },
  awaitingCrew: { tone: 'waiting', icon: 'hourglass', label: 'Awaiting crew' },
  crewed: { tone: 'ok', icon: 'check', label: 'Crewed' },
};

const sideSchema = z.object({ kind: z.enum(['server', 'client']).optional() });

const HTTP_FORBIDDEN = 403;
const HTTP_SEE_OTHER = 303;
const HTTP_INTERNAL_ERROR = 500;

const PAGE = '/outside-parties';

/** The scope that adds an outside MCP server: approving one needs it (0056). */
const ADDING_SCOPE = 'fleet:manage';
const TITLE = 'Outside parties';

const switchFormSchema = z.object({ isOn: z.enum(['true', 'false']), isOpenNetworkConfirmed: z.enum(['true', 'false']).optional() });

/** What the page says above its switch: the API's open-network warning, or why it refused. */
type Notice = { kind: 'openNetwork'; message: string } | { kind: 'refused'; message: string };

function switchCard(shown: { isOn: boolean; canSwitch: boolean }): string {
  const { isOn, canSwitch } = shown;
  const status = isOn ? statusBadge({ tone: 'ok', icon: 'power', label: 'On' }) : statusBadge({ tone: 'ended', icon: 'powerOff', label: 'Off' });
  const explained = isOn
    ? 'Approved outside MCP servers and clients reach the fleet, as its network rules allow.'
    : 'No outside MCP server or client reaches the fleet, and no request for one can be approved.';
  const control = canSwitch
    ? `<form method="post" action="${PAGE}/switch"><input type="hidden" name="isOn" value="${String(!isOn)}"><button class="${isOn ? '' : 'primary'}">${icon(isOn ? 'powerOff' : 'power', 14)}${isOn ? 'Turn off' : 'Turn on'}</button></form>`
    : `<p class="muted">Turning them on or off needs ${SWITCHING_SCOPE}.</p>`;
  return `<section class="card"><h2>Outside parties are ${isOn ? 'on' : 'off'} ${status}</h2><p class="muted">${explained}</p><div class="actions">${control}</div></section>`;
}

function noticeCard(notice: Notice): string {
  switch (notice.kind) {
    case 'openNetwork':
      return `<section class="card alert tone-attention" role="alert"><h2>${icon('alert', 16)} Open network</h2><p>${escaped(notice.message)}</p><div class="actions"><form method="post" action="${PAGE}/switch"><input type="hidden" name="isOn" value="true"><input type="hidden" name="isOpenNetworkConfirmed" value="true"><button class="destructive">Turn on anyway</button></form><a class="button" href="${PAGE}">Keep off</a></div></section>`;
    case 'refused':
      return `<section class="card alert tone-attention" role="alert"><p>${escaped(notice.message)}</p></section>`;
  }
}

function counted(count: number, side: Side): string {
  return `${icon(SIDES[side].icon, 14)} ${String(count)} ${count === 1 ? SIDES[side].one : SIDES[side].many}`;
}

/** How many outside parties the fleet has, per side and per protocol, under one ring. */
function lead(parties: readonly ShownParty[]): string {
  const sides = (['server', 'client'] as const).map((side) => counted(parties.filter((party) => PARTY_KINDS[party.kind].side === side).length, side));
  const protocols = [...new Set(parties.map((party) => PARTY_KINDS[party.kind].protocol))].map(
    (protocol) => `<span>${escaped(protocol)} ${String(parties.filter((party) => PARTY_KINDS[party.kind].protocol === protocol).length)}</span>`,
  );
  const count = parties.length;
  return `<div class="lead">${ring({ tone: count === 0 ? 'ended' : 'active', center: { count }, label: `${String(count)} outside parties` })}<div><h1>${TITLE}</h1><p class="muted counts">${[...sides, ...protocols].join(' · ')}</p></div></div>`;
}

function partyCard(party: ShownParty): string {
  const { protocol, side } = PARTY_KINDS[party.kind];
  const where = party.kind === 'mcpServer' ? party.url : party.clientId;
  return `<a class="party-card" href="${PAGE}/${encodeURIComponent(party.name)}">${partyMark(party.name)}<div class="text"><span><strong>${escaped(party.name)}</strong> <span class="tag protocol">${escaped(protocol)}</span></span><span class="tag">${icon(SIDES[side].icon, 12)}${escaped(protocol)} ${SIDES[side].one}</span><span class="tag mono" title="${escaped(where)}">${escaped(where)}</span></div><div class="facts">${statusBadge(PARTY_STATES[party.state])}${party.ownerShipId === null ? '' : `<span class="tag">${icon('users', 12)}<span class="mono">${escaped(party.ownerShipId)}</span></span>`}</div></a>`;
}

function partyList(parties: readonly ShownParty[], side: Side | undefined): string {
  const filters = [
    { label: 'All', href: PAGE, isCurrent: side === undefined },
    { label: 'Servers', href: `${PAGE}?kind=server`, isCurrent: side === 'server' },
    { label: 'Clients', href: `${PAGE}?kind=client`, isCurrent: side === 'client' },
  ]
    .map((filter) => `<a class="tab" href="${filter.href}"${filter.isCurrent ? ' aria-current="page"' : ''}>${filter.label}</a>`)
    .join('');
  const shown = side === undefined ? parties : parties.filter((party) => PARTY_KINDS[party.kind].side === side);
  const cards = shown.length === 0 ? '<p class="muted">No outside party yet.</p>' : `<div class="party-cards">${shown.map(partyCard).join('')}</div>`;
  return `<section style="display:grid;gap:12px"><nav class="tabs" aria-label="Show">${filters}</nav>${cards}</section>`;
}

async function renderPage(reply: FastifyReply, page: { context: Context; side?: Side; status?: number; notice?: Notice }): Promise<FastifyReply> {
  const { context, notice } = page;
  const caller = gatewayRouter.createCaller(context);
  const { isOn } = await caller.outsideParties.status();
  const parties = await caller.parties.list();
  const actor = await context.authenticateActor({ cookie: context.cookie, crewToken: context.crewToken });
  const canSwitch = actor.isOk && actor.value.scopes.includes(SWITCHING_SCOPE);
  const isSignedIn = actor.isOk && actor.value.kind === 'account';
  const canAdd = actor.isOk && actor.value.scopes.includes(ADDING_SCOPE);
  const add = canAdd ? `<div class="actions"><a class="button primary" href="${PAGE}/add">${icon('plug', 14)}Add server</a></div>` : '';
  const body = [lead(parties), add, notice ? noticeCard(notice) : '', switchCard({ isOn, canSwitch }), partyList(parties, page.side)].join('');
  return reply.code(page.status ?? 200).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(signalPage({ title: TITLE, tab: 'outsideParties', body, isSignedIn }));
}

function signInPage(reply: FastifyReply, refusal: { way: SignInWay; error: TRPCError }): FastifyReply {
  const body = signInPrompt({ message: refusal.error.message, way: refusal.way, returnTo: PAGE });
  return reply.code(getHTTPStatusCodeFromError(refusal.error)).type('text/html; charset=utf-8').send(signalPage({ title: TITLE, body }));
}

export function registerOutsidePartiesPage(server: FastifyInstance, deps: { contextFor: (cookie: string | undefined) => Context; signIn: SignInWay }): void {
  acceptForms(server);

  const answer = async (exchange: { request: FastifyRequest; reply: FastifyReply }, act?: (caller: ReturnType<typeof gatewayRouter.createCaller>) => Promise<unknown>) => {
    const { request, reply } = exchange;
    const context = deps.contextFor(request.headers.cookie);
    try {
      if (act) {
        await act(gatewayRouter.createCaller(context));
        return await reply.code(HTTP_SEE_OTHER).header('location', PAGE).send();
      }
      const side = sideSchema.safeParse(request.query);
      return await renderPage(reply, { context, ...(side.success && side.data.kind !== undefined ? { side: side.data.kind } : {}) });
    } catch (error) {
      if (!(error instanceof TRPCError)) {
        throw error;
      }
      if (error.code === 'UNAUTHORIZED') {
        return signInPage(reply, { way: deps.signIn, error });
      }
      const isInternal = error.code === 'INTERNAL_SERVER_ERROR';
      const status = isInternal ? HTTP_INTERNAL_ERROR : getHTTPStatusCodeFromError(error);
      const message = isInternal ? 'Internal error' : error.message;
      const notice: Notice = error.code === 'PRECONDITION_FAILED' ? { kind: 'openNetwork', message } : { kind: 'refused', message };
      try {
        return await renderPage(reply, { context, status, notice });
      } catch {
        return reply.code(status).type('text/html; charset=utf-8').send(signalPage({ title: TITLE, body: noticeCard(notice) }));
      }
    }
  };

  server.get(PAGE, (request, reply) => answer({ request, reply }));
  server.post(`${PAGE}/switch`, (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
    }
    const form = switchFormSchema.safeParse(request.body);
    if (!form.success) {
      return answer({ request, reply }, () => Promise.reject(new TRPCError({ code: 'BAD_REQUEST', message: 'The form is not valid' })));
    }
    const input = { isOn: form.data.isOn === 'true', isOpenNetworkConfirmed: form.data.isOpenNetworkConfirmed === 'true' };
    return answer({ request, reply }, (caller) => caller.outsideParties.set(input));
  });
}
