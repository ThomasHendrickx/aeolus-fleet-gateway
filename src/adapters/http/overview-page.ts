/**
 * The Overview page (design B, Signal): what waits on the caller. For an
 * actor holding gateway:approve, To decide holds every pending request of
 * the fleet (decision 0056), oldest first, each with its days left; a
 * request opens on its own with its decision beside the queue. Approving
 * names the proxy ship and its owner, and offers as scope rows only the
 * scopes the approver holds, messages:send and messages:receive locked on
 * (0046, 0053). The page calls the gateway's own API as the caller, so it
 * checks nothing the API does not; it refuses a form from another origin.
 */
import { idSchema } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { inferRouterOutputs } from '@trpc/server';

import type { Clock } from '../../core/shared/clock.js';
import { gatewayRouter, type Context, type GatewayRouter } from '../trpc/router.js';
import { acceptForms, escaped, isSameOrigin, refusalMessage } from './html.js';
import { handshake, icon, partyMark, ring, signalPage, statusBadge } from './signal.js';

/** A pending request as the API shows it. */
type ShownRequest = inferRouterOutputs<GatewayRouter>['requests']['toDecide'][number];

type Caller = ReturnType<typeof gatewayRouter.createCaller>;

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SEE_OTHER = 303;
const HTTP_INTERNAL_ERROR = 500;

const PAGE = '/overview';
const TITLE = 'Overview';
const DAY_MS = 86_400_000;
const CONCURRENCY_LIMIT_DEFAULT = 4;

/** The scopes every app ship gets (0046): shown locked on, and always sent. */
const EVERY_APP_SHIP_SCOPES: readonly string[] = ['messages:send', 'messages:receive'];

/** A scope's plain label, as the scope rows show it beside the scope itself. */
const SCOPE_LABELS: Record<string, string> = {
  'messages:send': 'Send',
  'messages:receive': 'Receive',
  'fleet:read': 'Read the fleet',
};

/** A form field that ticks a scope: `scope:<scope>`, one field per scope, as a form posts each name once. */
const SCOPE_FIELD_PREFIX = 'scope:';

const formSchema = z.record(z.string(), z.string());
type Form = Record<string, string>;

function field(form: Form, name: string): string {
  return form[name] ?? '';
}

/** How an outside party is named before it has a proxy ship: a client by its name, a server by its host. */
function subjectName(request: ShownRequest): string {
  switch (request.subject.kind) {
    case 'client':
      return request.subject.clientName;
    case 'server':
      return URL.canParse(request.subject.url) ? new URL(request.subject.url).host : request.subject.url;
  }
}

function subjectKind(request: ShownRequest): string {
  switch (request.subject.kind) {
    case 'client':
      return `${icon('laptop', 12)}MCP client`;
    case 'server':
      return `${icon('server', 12)}MCP server`;
  }
}

/** Days left of the 7 a request is kept, counted up, so its last day reads as such (in the attention tone). */
function daysLeft(request: ShownRequest, now: Date): string {
  const days = Math.ceil((Date.parse(request.expiresAt) - now.getTime()) / DAY_MS);
  return days <= 1 ? statusBadge({ tone: 'attention', icon: 'hourglass', label: 'Last day' }) : statusBadge({ tone: 'waiting', icon: 'hourglass', label: `${days} d left` });
}

function queueItem(request: ShownRequest, shown: { now: Date; isCurrent: boolean }): string {
  const name = subjectName(request);
  return `<a class="item" href="${PAGE}/requests/${encodeURIComponent(request.requestId)}"${shown.isCurrent ? ' aria-current="true"' : ''}>${partyMark(name)}<span class="text"><span>${escaped(name)}</span><span class="tag">${subjectKind(request)}</span></span>${daysLeft(request, shown.now)}</a>`;
}

/** Reads To decide as the caller; an actor who may not approve has nothing to decide. */
async function toDecideOf(caller: Caller): Promise<ShownRequest[] | undefined> {
  try {
    return await caller.requests.toDecide();
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'FORBIDDEN') {
      return undefined;
    }
    throw error;
  }
}

function overviewBody(toDecide: readonly ShownRequest[] | undefined, now: Date): string {
  if (toDecide === undefined) {
    return `<div class="lead">${ring({ tone: 'ok', center: { icon: 'check' }, label: 'Nothing waits on you' })}<h1>Nothing waits on you</h1></div>`;
  }
  const count = toDecide.length;
  const lead = `<div class="lead">${ring({ tone: count === 0 ? 'ok' : 'waiting', center: { count }, label: `${count} to decide` })}<div><h1>Waits on you</h1><p class="muted">${icon('hourglass', 14)} ${count} to decide</p></div></div>`;
  const queue =
    count === 0
      ? '<p class="muted">No request waits for a decision.</p>'
      : `<section class="queue"><h2>To decide · ${count}</h2>${toDecide.map((request) => queueItem(request, { now, isCurrent: false })).join('')}</section>`;
  return lead + queue;
}

function scopeRow(scope: string, isLocked: boolean): string {
  const label = escaped(SCOPE_LABELS[scope] ?? scope);
  const box = isLocked
    ? `<input type="checkbox" checked disabled aria-label="${label}">`
    : `<input type="checkbox" name="${SCOPE_FIELD_PREFIX}${escaped(scope)}" aria-label="${label}">`;
  return `<label class="scope">${box}<span class="label">${label}</span><span class="mono">${escaped(scope)}</span>${isLocked ? `<span class="muted">${icon('lock', 12)}</span>` : ''}</label>`;
}

const SERVER_FIELDS = `<fieldset><legend>The server's credential</legend>
<label class="field"><span>Credential</span><select name="credentialKind"><option value="bearer">Bearer token</option><option value="clientCredentials">OAuth client credentials</option></select></label>
<label class="field"><span>Bearer token</span><input type="password" name="token"></label>
<label class="field"><span>Client id</span><input type="text" name="clientId"></label>
<label class="field"><span>Client secret</span><input type="password" name="clientSecret"></label>
<label class="field"><span>Issuer</span><input type="url" name="issuer"></label>
<label class="field"><span>Scope</span><input type="text" name="scope"></label>
<label class="field"><span>Calls at once</span><input type="number" name="concurrencyLimit" min="1" max="10" value="${CONCURRENCY_LIMIT_DEFAULT}"></label>
</fieldset>`;

/** A proxy ship's name offered from the party's own: lower case letters, digits and dashes. */
function suggestedName(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function decisionCard(request: ShownRequest, scopes: readonly string[]): string {
  const name = subjectName(request);
  const action = `${PAGE}/requests/${encodeURIComponent(request.requestId)}/decide`;
  const held = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope));
  const rows = [...EVERY_APP_SHIP_SCOPES.map((scope) => scopeRow(scope, true)), ...held.map((scope) => scopeRow(scope, false))].join('');
  return `<section class="card"><h2>Approve ${escaped(name)}</h2>
<form method="post" action="${action}" style="display:grid;gap:12px"><input type="hidden" name="decision" value="approve">
<label class="field"><span>Proxy ship's name</span><input type="text" name="name" value="${escaped(suggestedName(name))}" required></label>
<label class="field"><span>Owner</span><input type="text" name="ownerShipId" placeholder="shp_..." required><span class="muted">A person ship. It answers for this party.</span></label>
<fieldset><legend>Scopes</legend><div class="scopes">${rows}</div></fieldset>
${request.subject.kind === 'server' ? SERVER_FIELDS : ''}
<div class="actions"><button class="primary">${icon('check', 14)}Approve</button></div></form>
<form method="post" action="${action}"><input type="hidden" name="decision" value="deny"><div class="actions"><button>${icon('ban', 14)}Deny</button></div></form></section>`;
}

function requestBody(shown: { request: ShownRequest; toDecide: readonly ShownRequest[]; scopes: readonly string[]; now: Date; notice?: string }): string {
  const { request, toDecide, scopes, now, notice } = shown;
  const count = toDecide.length;
  const requesters = request.requesters.length;
  const card = `<section class="card" style="justify-items:center;text-align:center">${handshake({ name: subjectName(request) })}<span class="tag">${subjectKind(request)}${icon('users', 12)}${requesters} ${requesters === 1 ? 'requester' : 'requesters'}</span>${daysLeft(request, now)}</section>`;
  const alert = notice === undefined ? '' : `<section class="card alert tone-attention" role="alert"><p>${escaped(notice)}</p></section>`;
  const queue = `<aside class="queue"><h2>Queue</h2>${toDecide.map((other) => queueItem(other, { now, isCurrent: other.requestId === request.requestId })).join('')}</aside>`;
  return `<div class="lead"><h1>${count} to decide</h1></div><div class="split"><div style="display:grid;gap:16px">${alert}${card}${decisionCard(request, scopes)}</div>${queue}</div>`;
}

function noLongerWaits(): string {
  return `<section class="card"><h2>This request no longer waits for a decision</h2><div class="actions"><a class="button" href="${PAGE}">Back to the overview</a></div></section>`;
}

/** The decision as the API takes it, from the form's fields; the API checks everything else. */
function decisionOf(form: Form): Parameters<Caller['requests']['decide']>[0]['decision'] {
  if (field(form, 'decision') !== 'approve') {
    return { kind: 'deny' };
  }
  const ticked = Object.keys(form)
    .filter((name) => name.startsWith(SCOPE_FIELD_PREFIX) && form[name] === 'on')
    .map((name) => name.slice(SCOPE_FIELD_PREFIX.length));
  const ownerShipId = idSchema('ship').safeParse(field(form, 'ownerShipId'));
  if (!ownerShipId.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "The owner's ship id is not a ship id (shp_...)" });
  }
  const party = { name: field(form, 'name'), ownerShipId: ownerShipId.data, scopes: [...EVERY_APP_SHIP_SCOPES, ...ticked] };
  if (form.credentialKind === undefined) {
    return { kind: 'approve', party };
  }
  const scope = field(form, 'scope');
  const credential =
    field(form, 'credentialKind') === 'clientCredentials'
      ? { kind: 'clientCredentials' as const, clientId: field(form, 'clientId'), clientSecret: field(form, 'clientSecret'), issuer: field(form, 'issuer'), ...(scope === '' ? {} : { scope }) }
      : { kind: 'bearer' as const, token: field(form, 'token') };
  return { kind: 'approve', party, server: { credential, concurrencyLimit: Number(field(form, 'concurrencyLimit')) } };
}

function html(reply: FastifyReply, page: { status: number; body: string; isWide?: boolean }): FastifyReply {
  return reply
    .code(page.status)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(signalPage({ title: TITLE, tab: 'overview', body: page.body, ...(page.isWide === undefined ? {} : { isWide: page.isWide }) }));
}

function signInPage(reply: FastifyReply, refusal: { fleetUrl: string; error: TRPCError }): FastifyReply {
  const { fleetUrl, error } = refusal;
  const body = `<section class="card"><h2>${escaped(error.message)}</h2><div class="actions"><a class="button" href="${escaped(fleetUrl)}">${icon('signIn', 14)}Sign in to the console of your fleet</a></div></section>`;
  return reply.code(getHTTPStatusCodeFromError(error)).type('text/html; charset=utf-8').send(signalPage({ title: TITLE, body }));
}

export function registerOverviewPage(server: FastifyInstance, deps: { contextFor: (cookie: string | undefined) => Context; fleetUrl: string; clock: Clock }): void {
  acceptForms(server);

  const renderRequest = async (reply: FastifyReply, shown: { context: Context; requestId: string; status?: number; notice?: string }) => {
    const { context, requestId } = shown;
    const toDecide = (await toDecideOf(gatewayRouter.createCaller(context))) ?? [];
    const request = toDecide.find((open) => open.requestId === requestId);
    if (request === undefined) {
      return html(reply, { status: HTTP_NOT_FOUND, body: (shown.notice === undefined ? '' : `<section class="card alert tone-attention" role="alert"><p>${escaped(shown.notice)}</p></section>`) + noLongerWaits() });
    }
    const actor = await context.authenticateActor({ cookie: context.cookie, crewToken: context.crewToken });
    const scopes = actor.isOk ? actor.value.scopes : [];
    return html(reply, { status: shown.status ?? 200, isWide: true, body: requestBody({ request, toDecide, scopes, now: deps.clock.now(), ...(shown.notice === undefined ? {} : { notice: shown.notice }) }) });
  };

  const answer = async (exchange: {
    request: FastifyRequest;
    reply: FastifyReply;
    render: (context: Context) => Promise<FastifyReply>;
    onRefused?: (context: Context, refused: { status: number; message: string }) => Promise<FastifyReply>;
  }) => {
    const { request, reply, render, onRefused } = exchange;
    const context = deps.contextFor(request.headers.cookie);
    try {
      return await render(context);
    } catch (error) {
      if (!(error instanceof TRPCError)) {
        throw error;
      }
      if (error.code === 'UNAUTHORIZED') {
        return signInPage(reply, { fleetUrl: deps.fleetUrl, error });
      }
      const refused = { status: error.code === 'INTERNAL_SERVER_ERROR' ? HTTP_INTERNAL_ERROR : getHTTPStatusCodeFromError(error), message: refusalMessage(error) };
      try {
        if (onRefused) {
          return await onRefused(context, refused);
        }
      } catch {
        // The page itself cannot be read again: the refusal alone follows.
      }
      return html(reply, { status: refused.status, body: `<section class="card alert tone-attention" role="alert"><p>${escaped(refused.message)}</p></section>` });
    }
  };

  server.get(PAGE, (request, reply) =>
    answer({
      request,
      reply,
      render: async (context) => {
        const toDecide = await toDecideOf(gatewayRouter.createCaller(context));
        return html(reply, { status: 200, body: overviewBody(toDecide, deps.clock.now()) });
      },
    }),
  );

  server.get<{ Params: { requestId: string } }>(`${PAGE}/requests/:requestId`, (request, reply) =>
    answer({ request, reply, render: (context) => renderRequest(reply, { context, requestId: request.params.requestId }) }),
  );

  server.post<{ Params: { requestId: string } }>(`${PAGE}/requests/:requestId/decide`, (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
    }
    const form = formSchema.safeParse(request.body);
    const { requestId } = request.params;
    return answer({
      request,
      reply,
      render: async (context) => {
        await gatewayRouter.createCaller(context).requests.decide({ requestId, decision: decisionOf(form.success ? form.data : {}) });
        return reply.code(HTTP_SEE_OTHER).header('location', PAGE).send();
      },
      onRefused: (context, refused) => renderRequest(reply, { context, requestId, status: refused.status, notice: refused.message }),
    });
  });
}
