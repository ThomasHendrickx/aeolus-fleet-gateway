/**
 * The gateway's page of parties: one small server-rendered page where argo,
 * signed in to the console, approves outside MCP servers, hands over a
 * secret, states a party and marks its tools. Each form calls the gateway's
 * own API as argo, with the forwarded console session, so the page checks
 * nothing the API does not; it only refuses a form sent from another origin.
 */
import { randomUUID } from 'node:crypto';

import { idSchema } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { inferRouterOutputs } from '@trpc/server';

import { gatewayRouter, type Context, type GatewayRouter } from '../trpc/router.js';
import { acceptForms, escaped, isSameOrigin, layout } from './html.js';

/** A party as the API shows it. */
type ShownParty = inferRouterOutputs<GatewayRouter>['parties']['list'][number];

const HTTP_FORBIDDEN = 403;
const HTTP_SEE_OTHER = 303;
const HTTP_INTERNAL_ERROR = 500;

const PAGE = '/parties';

const formSchema = z.record(z.string(), z.string());

type Form = Record<string, string>;


function field(form: Form, name: string): string {
  return form[name] ?? '';
}


function partyRow(party: ShownParty, canManage: boolean): string {
  const name = escaped(party.name);
  const forms = canManage
    ? [
        party.state === 'awaitingCrew'
          ? `<form class="inline" method="post" action="${PAGE}/crew"><input type="hidden" name="name" value="${name}"><input name="secret" placeholder="secret from a new starting prompt" required><button>Crew</button></form>`
          : '',
        party.state === 'crewed'
          ? `<form class="inline" method="post" action="${PAGE}/state"><input type="hidden" name="name" value="${name}"><button>State its tools</button></form>` +
            `<form class="inline" method="post" action="${PAGE}/mark"><input type="hidden" name="name" value="${name}"><input name="tool" placeholder="tool" required maxlength="128"><label><span><input type="checkbox" name="isRepeatable"> repeatable</span></label><button>Mark</button></form>`
          : '',
      ].join('')
    : '';
  return `<tr><td>${name}</td><td>${escaped(party.url)}</td><td>${escaped(party.credentialKind)}</td><td>${escaped(party.state)}</td><td>${escaped(party.proxyShipId ?? '')}</td><td>${forms}</td></tr>`;
}

const APPROVE_FORM = (requestId: string) => `<h2>Approve an MCP server</h2>
<form method="post" action="${PAGE}/approve">
<input type="hidden" name="requestId" value="${requestId}">
<label>Name, the proxy ship's<input name="name" required></label>
<label>Streamable HTTP URL<input name="url" type="url" required></label>
<label>Credential<select name="credentialKind"><option value="bearer">Bearer token</option><option value="clientCredentials">OAuth client credentials</option></select></label>
<label>Bearer token<input name="token" type="password"></label>
<label>Client id<input name="clientId"></label>
<label>Client secret<input name="clientSecret" type="password"></label>
<label>Issuer<input name="issuer" type="url"></label>
<label>Scope<input name="scope"></label>
<label>Owner's ship id (a person's ship, or argo)<input name="ownerShipId" required></label>
<label>Calls at once<input name="concurrencyLimit" type="number" min="1" max="10" value="4"></label>
<button>Approve</button>
</form>`;

/** Why the API refused, as the page says it: the form's fields that are not valid, or the API's message. */
function messageOf(error: TRPCError): string {
  if (error.cause instanceof z.ZodError) {
    return `The form is not valid: ${error.cause.issues.map((issue) => `${issue.path.join('.') || 'form'}: ${issue.message}`).join('; ')}`;
  }
  return error.code === 'INTERNAL_SERVER_ERROR' ? 'Internal error' : error.message;
}

async function renderPage(reply: FastifyReply, page: { context: Context; failure?: { status: number; message: string } }): Promise<FastifyReply> {
  const { context, failure } = page;
  const caller = gatewayRouter.createCaller(context);
  const operator = await context.authenticateOperator(context.cookie);
  const parties = await caller.parties.list();
  const canManage = operator.isOk && operator.value.scopes.includes('fleet:manage');
  const body = [
    '<h1>Parties</h1>',
    '<p class="muted">Outside MCP servers argo approved for this fleet, each behind its proxy ship.</p>',
    failure ? `<p class="error">${escaped(failure.message)}</p>` : '',
    parties.length === 0
      ? '<p class="muted">No party yet.</p>'
      : `<table><thead><tr><th>Name</th><th>URL</th><th>Credential</th><th>State</th><th>Proxy ship</th><th></th></tr></thead><tbody>${parties.map((party) => partyRow(party, canManage)).join('')}</tbody></table>`,
    canManage ? APPROVE_FORM(randomUUID()) : '',
  ].join('');
  return reply.code(failure?.status ?? 200).type('text/html; charset=utf-8').send(layout('Gateway parties', body));
}

function signInPage(reply: FastifyReply, refusal: { fleetUrl: string; error: TRPCError }): FastifyReply {
  const { fleetUrl, error } = refusal;
  return reply
    .code(getHTTPStatusCodeFromError(error))
    .type('text/html; charset=utf-8')
    .send(layout('Gateway parties', `<h1>Parties</h1><p class="error">${escaped(messageOf(error))}</p><p><a href="${escaped(fleetUrl)}">Sign in to the console of your fleet</a>, then come back.</p>`));
}


/** The calls each form makes, as argo, from its fields. */
const ACTIONS: Record<string, (caller: ReturnType<typeof gatewayRouter.createCaller>, form: Form) => Promise<unknown>> = {
  approve: (caller, form) => {
    const ownerShipId = idSchema('ship').safeParse(field(form, 'ownerShipId'));
    if (!ownerShipId.success) {
      return Promise.reject(new TRPCError({ code: 'BAD_REQUEST', message: "The owner's ship id is not a ship id (shp_...)" }));
    }
    const scope = field(form, 'scope');
    return caller.parties.approve({
      requestId: field(form, 'requestId'),
      name: field(form, 'name'),
      url: field(form, 'url'),
      credential:
        field(form, 'credentialKind') === 'clientCredentials'
          ? { kind: 'clientCredentials', clientId: field(form, 'clientId'), clientSecret: field(form, 'clientSecret'), issuer: field(form, 'issuer'), ...(scope === '' ? {} : { scope }) }
          : { kind: 'bearer', token: field(form, 'token') },
      ownerShipId: ownerShipId.data,
      concurrencyLimit: Number(field(form, 'concurrencyLimit')),
    });
  },
  crew: (caller, form) => caller.parties.crew({ name: field(form, 'name'), secret: field(form, 'secret') }),
  state: (caller, form) => caller.parties.state({ name: field(form, 'name') }),
  mark: (caller, form) => caller.parties.markTool({ name: field(form, 'name'), tool: field(form, 'tool'), isRepeatable: form.isRepeatable === 'on' }),
};

export function registerPartiesPage(server: FastifyInstance, deps: { contextFor: (cookie: string | undefined) => Context; fleetUrl: string }): void {
  acceptForms(server);

  const answer = async (exchange: { request: FastifyRequest; reply: FastifyReply }, act?: (caller: ReturnType<typeof gatewayRouter.createCaller>) => Promise<unknown>) => {
    const { request, reply } = exchange;
    const context = deps.contextFor(request.headers.cookie);
    try {
      if (act) {
        await act(gatewayRouter.createCaller(context));
        return await reply.code(HTTP_SEE_OTHER).header('location', PAGE).send();
      }
      return await renderPage(reply, { context });
    } catch (error) {
      if (!(error instanceof TRPCError)) {
        throw error;
      }
      if (error.code === 'UNAUTHORIZED') {
        return signInPage(reply, { fleetUrl: deps.fleetUrl, error });
      }
      const failure = { status: error.code === 'INTERNAL_SERVER_ERROR' ? HTTP_INTERNAL_ERROR : getHTTPStatusCodeFromError(error), message: messageOf(error) };
      try {
        return await renderPage(reply, { context, failure });
      } catch {
        return reply.code(failure.status).type('text/html; charset=utf-8').send(layout('Gateway parties', `<h1>Parties</h1><p class="error">${escaped(failure.message)}</p>`));
      }
    }
  };

  server.get(PAGE, (request, reply) => answer({ request, reply }));
  for (const [action, call] of Object.entries(ACTIONS)) {
    server.post(`${PAGE}/${action}`, (request, reply) => {
      if (!isSameOrigin(request)) {
        return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
      }
      const form = formSchema.safeParse(request.body);
      return answer({ request, reply }, (caller) => call(caller, form.success ? form.data : {}));
    });
  }
}
