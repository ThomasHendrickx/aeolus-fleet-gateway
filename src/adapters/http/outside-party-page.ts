/**
 * One outside party, on its own page (design B, Signal, screens 12 and 14):
 * the handshake of party and fleet, its proxy ship's state, then its facts
 * as the fleet holds them: proxy ship, owner and scopes (decision 0056),
 * and for an MCP server the tools it lists now, read-only (turning a tool
 * off and on comes later).
 * An actor holding fleet:owner changes its owner, one holding scopes:grant
 * its scopes, only scopes it holds; one holding fleet:manage retires it,
 * after one confirm that lists what happens. Each page calls the gateway's own API as the caller, so it
 * checks nothing the API does not; it shows each control only to an actor
 * holding its scope and refuses a form sent from another origin.
 */
import { idSchema } from '@aeolus-fleet/common';
import { TRPCError, type inferRouterOutputs } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { GRANTING_SCOPE, OWNING_SCOPE } from '../../core/parties/change-party.js';
import { RETIRING_SCOPE } from '../../core/parties/retire-party.js';
import { gatewayRouter, type Context, type GatewayRouter } from '../trpc/router.js';
import { acceptForms, escaped, isSameOrigin } from './html.js';
import { PARTY_KINDS, PARTY_STATES, SIDES } from './outside-parties-page.js';
import { EVERY_APP_SHIP_SCOPES, SCOPE_FIELD_PREFIX, scopeRow } from './scope-rows.js';
import { handshake, icon, ring, signalPage, signInPrompt, statusBadge, type SignInWay } from './signal.js';

/** An outside party as the API shows it. */
type ListedParty = inferRouterOutputs<GatewayRouter>['parties']['get'];

/** An outside MCP server's tools as the server answers them now, or why it could not be listed. */
type ToolsRead = { tools: inferRouterOutputs<GatewayRouter>['parties']['tools']['tools'] } | { refusal: string };

const HTTP_FORBIDDEN = 403;
const HTTP_SEE_OTHER = 303;
const HTTP_INTERNAL_ERROR = 500;

const LIST = '/outside-parties';
const TITLE = 'Outside parties';

const formSchema = z.record(z.string(), z.string());

/** The field a change form sends when it shows the scope rows, so rows it did not show revoke nothing. */
const SCOPES_SHOWN_FIELD = 'scopesShown';

function partyPath(name: string, action?: 'retire' | 'change'): string {
  return `${LIST}/${encodeURIComponent(name)}${action === undefined ? '' : `/${action}`}`;
}

const BACK = `<a class="back" href="${LIST}">${icon('arrowLeft', 14)}${TITLE}</a>`;

function head(party: ListedParty): string {
  const { protocol, side } = PARTY_KINDS[party.kind];
  return `<div class="party-head">${handshake({ name: party.name })}<div class="facts"><span class="tag protocol">${escaped(protocol)}</span><span class="tag">${icon(SIDES[side].icon, 12)}${SIDES[side].one}</span>${statusBadge(PARTY_STATES[party.state])}</div></div>`;
}

function fact(row: { icon: Parameters<typeof icon>[0]; label: string; value: string }): string {
  return `<div><dt>${icon(row.icon, 14)}${escaped(row.label)}</dt><dd>${row.value}</dd></div>`;
}

/** What the fleet holds is none while the party has no proxy ship, or the fleet does not answer. */
const UNKNOWN = '<span class="muted">Not known</span>';

function facts(party: ListedParty, scopes: readonly string[]): string {
  const where = party.kind === 'mcpServer' ? { label: 'Address', value: party.url } : { label: 'Client id', value: party.clientId };
  const change = `<a href="${partyPath(party.name, 'change')}">Change</a>`;
  const owner = (party.ownerShipId === null ? UNKNOWN : `<span class="mono">${escaped(party.ownerShipId)}</span>`) + (scopes.includes(OWNING_SCOPE) ? change : '');
  const held = (party.scopes === null ? UNKNOWN : party.scopes.map((scope) => `<span class="tag mono">${escaped(scope)}</span>`).join('')) + (scopes.includes(GRANTING_SCOPE) ? change : '');
  return `<dl class="fact-rows">${[
    fact({ icon: 'ship', label: 'Proxy ship', value: party.proxyShipId === null ? UNKNOWN : `<span class="mono">${escaped(party.proxyShipId)}</span>` }),
    fact({ icon: 'users', label: 'Owner', value: owner }),
    fact({ icon: 'shield', label: 'Scopes', value: held }),
    fact({ icon: SIDES[PARTY_KINDS[party.kind].side].icon, label: where.label, value: `<span class="mono">${escaped(where.value)}</span>` }),
  ].join('')}</dl>`;
}

function toolsCard(read: ToolsRead): string {
  if ('refusal' in read) {
    return `<section class="card"><h2>${icon('plug', 14)} Tools</h2><p class="muted">${escaped(read.refusal)}</p></section>`;
  }
  const rows = read.tools.map((tool) => `<li><span class="mono">${escaped(tool.name)}</span>${tool.description === undefined ? '' : `<span class="muted">${escaped(tool.description)}</span>`}</li>`).join('');
  return `<section class="card"><h2 class="split-heading"><span>${icon('plug', 14)} Tools</span><span class="count">${String(read.tools.length)}</span></h2><ul class="tool-rows">${rows}</ul></section>`;
}

/** The server's tools as the API answers them; a refusal is shown in their place, never failing the page. */
async function toolsOf(caller: ReturnType<typeof gatewayRouter.createCaller>, party: ListedParty): Promise<ToolsRead | undefined> {
  if (party.kind !== 'mcpServer') {
    return undefined;
  }
  try {
    return await caller.parties.tools({ name: party.name });
  } catch (error) {
    if (error instanceof TRPCError) {
      return { refusal: error.code === 'INTERNAL_SERVER_ERROR' ? 'Internal error' : error.message };
    }
    throw error;
  }
}

function partyBody(party: ListedParty, shown: { scopes: readonly string[]; refusal?: string; tools?: ToolsRead }): string {
  const refusal = shown.refusal === undefined ? '' : `<section class="card alert tone-attention" role="alert"><p>${escaped(shown.refusal)}</p></section>`;
  const retire = shown.scopes.includes(RETIRING_SCOPE) ? `<div class="actions"><a class="button" href="${partyPath(party.name, 'retire')}">${icon('archive', 14)}Retire ${escaped(party.name)}…</a></div>` : '';
  return [BACK, head(party), refusal, facts(party, shown.scopes), shown.tools === undefined ? '' : toolsCard(shown.tools), retire].join('');
}

/** The scope rows: every app ship's locked on, the actor's own to tick, and what the party holds beyond them locked as it is. */
function scopeRows(party: ListedParty & { scopes: string[] }, scopes: readonly string[]): string {
  const own = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope));
  const beyond = party.scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope) && !own.includes(scope));
  return [
    ...EVERY_APP_SHIP_SCOPES.map((scope) => scopeRow({ scope, isLocked: true })),
    ...own.map((scope) => scopeRow({ scope, isChecked: party.scopes.includes(scope) })),
    ...beyond.map((scope) => scopeRow({ scope, isLocked: true })),
  ].join('');
}

function changeBody(party: ListedParty, scopes: readonly string[]): string {
  const owner = scopes.includes(OWNING_SCOPE)
    ? `<label class="field"><span>Owner</span><input type="text" name="ownerShipId" value="${escaped(party.ownerShipId ?? '')}" placeholder="shp_..." required><span class="muted">A person ship. It answers for this party.</span></label>`
    : '';
  const { scopes: held } = party;
  const rows =
    scopes.includes(GRANTING_SCOPE) && held !== null
      ? `<input type="hidden" name="${SCOPES_SHOWN_FIELD}" value="true"><fieldset><legend>Scopes</legend><div class="scopes">${scopeRows({ ...party, scopes: held }, scopes)}</div></fieldset>`
      : '';
  return `${BACK}<section class="card"><h2>${escaped(party.name)}: owner and scopes</h2>
<form method="post" action="${partyPath(party.name, 'change')}" style="display:grid;gap:12px">${owner}${rows}<div class="actions"><button class="primary">${icon('check', 14)}Save</button><a class="button" href="${partyPath(party.name)}">Cancel</a></div></form></section>`;
}

/** What a change form asks of the API: only what differs from the party as the fleet holds it. */
function changesOf(party: ListedParty, sent: { form: Record<string, string>; scopes: readonly string[] }): { ownerShipId?: z.infer<ReturnType<typeof idSchema<'ship'>>>; grant: string[]; revoke: string[] } {
  const { form, scopes } = sent;
  const sentOwner = form.ownerShipId?.trim();
  let ownerShipId;
  if (sentOwner !== undefined && sentOwner !== party.ownerShipId) {
    const parsed = idSchema('ship').safeParse(sentOwner);
    if (!parsed.success) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: "The owner's ship id is not a ship id (shp_...)" });
    }
    ownerShipId = parsed.data;
  }
  const held = party.scopes;
  if (form[SCOPES_SHOWN_FIELD] !== 'true' || held === null) {
    return { ...(ownerShipId === undefined ? {} : { ownerShipId }), grant: [], revoke: [] };
  }
  const own = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope));
  const isTicked = (scope: string) => form[`${SCOPE_FIELD_PREFIX}${scope}`] !== undefined;
  return {
    ...(ownerShipId === undefined ? {} : { ownerShipId }),
    grant: own.filter((scope) => isTicked(scope) && !held.includes(scope)),
    revoke: own.filter((scope) => !isTicked(scope) && held.includes(scope)),
  };
}

function retireBody(party: ListedParty): string {
  const proxyShip = party.proxyShipId === null ? 'Its proxy ship is retired' : `Its proxy ship <span class="mono">${escaped(party.proxyShipId)}</span> is retired`;
  return `${BACK}<section class="card" style="justify-items:center;text-align:center">${ring({ tone: 'attention', center: { icon: 'archive' }, label: `Retire ${party.name}` })}<h2>Retire ${escaped(party.name)}?</h2>
<ul class="consequences" style="text-align:left"><li>${icon('ship', 14)}<span>${proxyShip}</span></li><li>${icon('users', 14)}<span>The ships that used it lose its tools</span></li><li>${icon('arrowLeftRight', 14)}<span>Adding it again is a new request</span></li></ul>
<form method="post" action="${partyPath(party.name, 'retire')}" class="actions" style="width:100%"><button class="destructive">${icon('archive', 14)}Retire ${escaped(party.name)}</button><a class="button" href="${partyPath(party.name)}">Cancel</a></form></section>`;
}

function html(reply: FastifyReply, page: { status: number; body: string; isSignedIn: boolean }): FastifyReply {
  return reply
    .code(page.status)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(signalPage({ title: TITLE, tab: 'outsideParties', body: page.body, isSignedIn: page.isSignedIn }));
}

export function registerOutsidePartyPage(server: FastifyInstance, deps: { contextFor: (cookie: string | undefined) => Context; signIn: SignInWay }): void {
  acceptForms(server);

  /** Renders a page as the caller, and says why the API refused, or asks to sign in. */
  const answer = async (
    exchange: { request: FastifyRequest<{ Params: { name: string } }>; reply: FastifyReply },
    render: (shown: { caller: ReturnType<typeof gatewayRouter.createCaller>; scopes: readonly string[]; isSignedIn: boolean }) => Promise<FastifyReply>,
  ) => {
    const { request, reply } = exchange;
    const context = deps.contextFor(request.headers.cookie);
    const caller = gatewayRouter.createCaller(context);
    const actor = await context.authenticateActor({ cookie: context.cookie, crewToken: context.crewToken });
    const scopes = actor.isOk ? actor.value.scopes : [];
    const isSignedIn = actor.isOk && actor.value.kind === 'account';
    try {
      return await render({ caller, scopes, isSignedIn });
    } catch (error) {
      if (!(error instanceof TRPCError)) {
        throw error;
      }
      const name = request.params.name;
      if (error.code === 'UNAUTHORIZED') {
        const returnTo = request.method === 'GET' ? request.url : partyPath(name);
        return reply
          .code(getHTTPStatusCodeFromError(error))
          .type('text/html; charset=utf-8')
          .send(signalPage({ title: TITLE, body: signInPrompt({ message: error.message, way: deps.signIn, returnTo }) }));
      }
      const isInternal = error.code === 'INTERNAL_SERVER_ERROR';
      const status = isInternal ? HTTP_INTERNAL_ERROR : getHTTPStatusCodeFromError(error);
      const refusal = isInternal ? 'Internal error' : error.message;
      // A refused form shows the party again, with why; a party that is not there, or not to be read either, shows only why.
      const party = error.code === 'NOT_FOUND' ? undefined : await caller.parties.get({ name }).catch(() => undefined);
      if (party !== undefined) {
        return html(reply, { status, body: partyBody(party, { scopes, refusal }), isSignedIn });
      }
      return html(reply, { status, body: `${BACK}<section class="card alert tone-attention" role="alert"><p>${escaped(refusal)}</p></section>`, isSignedIn });
    }
  };

  server.get<{ Params: { name: string } }>(`${LIST}/:name`, (request, reply) =>
    answer({ request, reply }, async ({ caller, scopes, isSignedIn }) => {
      const party = await caller.parties.get({ name: request.params.name });
      const tools = await toolsOf(caller, party);
      return html(reply, { status: 200, body: partyBody(party, { scopes, ...(tools === undefined ? {} : { tools }) }), isSignedIn });
    }),
  );
  server.get<{ Params: { name: string } }>(`${LIST}/:name/change`, (request, reply) =>
    answer({ request, reply }, async ({ caller, scopes, isSignedIn }) => html(reply, { status: 200, body: changeBody(await caller.parties.get({ name: request.params.name }), scopes), isSignedIn })),
  );
  server.get<{ Params: { name: string } }>(`${LIST}/:name/retire`, (request, reply) =>
    answer({ request, reply }, async ({ caller, isSignedIn }) => html(reply, { status: 200, body: retireBody(await caller.parties.get({ name: request.params.name })), isSignedIn })),
  );
  server.post<{ Params: { name: string } }>(`${LIST}/:name/change`, (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
    }
    const form = formSchema.safeParse(request.body);
    return answer({ request, reply }, async ({ caller, scopes }) => {
      const { name } = request.params;
      const { ownerShipId, grant, revoke } = changesOf(await caller.parties.get({ name }), { form: form.success ? form.data : {}, scopes });
      if (ownerShipId !== undefined) {
        await caller.parties.changeOwner({ name, ownerShipId });
      }
      if (grant.length > 0 || revoke.length > 0) {
        await caller.parties.changeScopes({ name, grant, revoke });
      }
      return reply.code(HTTP_SEE_OTHER).header('location', partyPath(name)).send();
    });
  });
  server.post<{ Params: { name: string } }>(`${LIST}/:name/retire`, (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
    }
    return answer({ request, reply }, async ({ caller }) => {
      await caller.parties.retire({ name: request.params.name });
      return reply.code(HTTP_SEE_OTHER).header('location', LIST).send();
    });
  });
}
