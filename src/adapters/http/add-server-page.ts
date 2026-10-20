/**
 * Adding an outside MCP server (design B, Signal, screen 7; flow F10), for
 * an actor holding fleet:manage, in three steps: its address and
 * credential, the gateway's check of the tools it answers with, then its
 * owner, when it is approved. The check keeps nothing, so the owner step
 * carries the address and credential on in its form, on a page no cache
 * keeps. Each step calls the gateway's own API as the caller, so the pages
 * check nothing the API does not; they refuse a form sent from another
 * origin.
 */
import { randomUUID } from 'node:crypto';

import { idSchema } from '@aeolus-fleet/common';
import { TRPCError, type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { gatewayRouter, type Context, type GatewayRouter } from '../trpc/router.js';
import { acceptForms, escaped, isSameOrigin } from './html.js';
import { icon, ring, signalPage, signInPrompt, statusBadge, type SignInWay } from './signal.js';

/** The tools a check answers. */
type CheckedTools = inferRouterOutputs<GatewayRouter>['parties']['check']['tools'];

/** The credential the gateway signs in to the server with, as the API takes it. */
type Credential = inferRouterInputs<GatewayRouter>['parties']['check']['credential'];

const HTTP_FORBIDDEN = 403;
const HTTP_SEE_OTHER = 303;
const HTTP_INTERNAL_ERROR = 500;

const LIST = '/outside-parties';
const PAGE = `${LIST}/add`;
const TITLE = 'Add MCP server';
const CONCURRENCY_LIMIT_DEFAULT = 4;

const formSchema = z.record(z.string(), z.string());
type Form = Record<string, string>;

/** The credential fields a form sends, in the order the address step asks for them. */
const CREDENTIAL_FIELDS = ['credentialKind', 'token', 'clientId', 'clientSecret', 'issuer', 'scope'] as const;

/** The steps of adding a server, as the design numbers them. */
const STEPS = ['Address', 'Check', 'Owner'] as const;

type Step = (typeof STEPS)[number];

function field(form: Form, name: string): string {
  return form[name] ?? '';
}

function steps(current: Step): string {
  const at = STEPS.indexOf(current);
  const items = STEPS.map((step, index) => `<li class="${index <= at ? 'done' : ''}"${index === at ? ' aria-current="step"' : ''}>${String(index + 1)} ${step}</li>`).join('');
  return `<ol class="steps">${items}</ol>`;
}

function head(current: Step): string {
  return `<a class="back" href="${LIST}">${icon('arrowLeft', 14)}Outside parties</a><div class="lead"><h1>${TITLE}</h1></div>${steps(current)}`;
}

function alert(message: string | undefined): string {
  return message === undefined ? '' : `<section class="card alert tone-attention" role="alert"><p>${escaped(message)}</p></section>`;
}

function credentialOf(form: Form): Credential {
  if (field(form, 'credentialKind') === 'clientCredentials') {
    const scope = field(form, 'scope');
    return { kind: 'clientCredentials', clientId: field(form, 'clientId'), clientSecret: field(form, 'clientSecret'), issuer: field(form, 'issuer'), ...(scope === '' ? {} : { scope }) };
  }
  return { kind: 'bearer', token: field(form, 'token') };
}

function addressBody(form: Form, refusal?: string): string {
  const isClient = field(form, 'credentialKind') === 'clientCredentials';
  return `${head('Address')}${alert(refusal)}<section class="card"><form method="post" action="${PAGE}/check" style="display:grid;gap:12px">
<label class="field"><span>Streamable HTTP address</span><input type="url" name="url" value="${escaped(field(form, 'url'))}" placeholder="https://mcp.example.com/mcp" required></label>
<fieldset><legend>The server's credential</legend>
<label class="field"><span>Credential</span><select name="credentialKind"><option value="bearer">Bearer token</option><option value="clientCredentials"${isClient ? ' selected' : ''}>OAuth client credentials</option></select></label>
<label class="field"><span>Bearer token</span><input type="password" name="token"></label>
<label class="field"><span>Client id</span><input type="text" name="clientId" value="${escaped(field(form, 'clientId'))}"></label>
<label class="field"><span>Client secret</span><input type="password" name="clientSecret"></label>
<label class="field"><span>Issuer</span><input type="url" name="issuer" value="${escaped(field(form, 'issuer'))}"></label>
<label class="field"><span>Scope</span><input type="text" name="scope" value="${escaped(field(form, 'scope'))}"></label>
</fieldset>
<div class="actions"><button class="primary">${icon('check', 14)}Check the server</button></div></form></section>`;
}

/** A proxy ship's name offered from the server's address: its host's first name that says whose it is. */
function suggestedName(url: string): string {
  try {
    const labels = new URL(url).hostname.split('.').filter((label) => label !== 'mcp' && label !== 'www');
    return (labels[0] ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
  } catch {
    return '';
  }
}

/** The address and credential, carried on in the owner step's form. */
function carried(form: Form): string {
  return ['url', ...CREDENTIAL_FIELDS].map((name) => `<input type="hidden" name="${name}" value="${escaped(field(form, name))}">`).join('');
}

function toolsCard(tools: CheckedTools): string {
  const count = tools.length;
  const rows = tools.map((tool) => `<li><span class="mono">${escaped(tool.name)}</span>${tool.description === undefined ? '' : `<span class="muted">${escaped(tool.description)}</span>`}</li>`).join('');
  return `<section class="card" style="justify-items:center;text-align:center">${ring({ tone: 'ok', center: { count }, label: `${String(count)} ${count === 1 ? 'tool' : 'tools'}` })}${statusBadge({ tone: 'ok', icon: 'check', label: 'Server answers' })}<ul class="tool-rows">${rows}</ul></section>`;
}

function ownerBody(form: Form, shown: { tools?: CheckedTools; refusal?: string }): string {
  const requestId = field(form, 'requestId') === '' ? randomUUID() : field(form, 'requestId');
  const name = field(form, 'name') === '' ? suggestedName(field(form, 'url')) : field(form, 'name');
  const limit = field(form, 'concurrencyLimit') === '' ? String(CONCURRENCY_LIMIT_DEFAULT) : field(form, 'concurrencyLimit');
  return `${head(shown.tools === undefined ? 'Owner' : 'Check')}${alert(shown.refusal)}${shown.tools === undefined ? '' : toolsCard(shown.tools)}<section class="card"><h2>Its owner</h2>
<form method="post" action="${PAGE}" style="display:grid;gap:12px"><input type="hidden" name="requestId" value="${escaped(requestId)}">${carried(form)}
<p class="muted mono">${escaped(field(form, 'url'))}</p>
<label class="field"><span>Proxy ship's name</span><input type="text" name="name" value="${escaped(name)}" required></label>
<label class="field"><span>Owner</span><input type="text" name="ownerShipId" value="${escaped(field(form, 'ownerShipId'))}" placeholder="shp_..." required><span class="muted">A person ship. It answers for this server.</span></label>
<label class="field"><span>Calls at once</span><input type="number" name="concurrencyLimit" min="1" max="10" value="${escaped(limit)}"></label>
<div class="actions"><button class="primary">${icon('check', 14)}Add ${escaped(name === '' ? 'server' : name)}</button><a class="button" href="${PAGE}">Back to the address</a></div></form></section>`;
}

function html(reply: FastifyReply, page: { status: number; body: string; isSignedIn: boolean }): FastifyReply {
  return reply
    .code(page.status)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(signalPage({ title: TITLE, tab: 'outsideParties', body: page.body, isSignedIn: page.isSignedIn }));
}

export function registerAddServerPage(server: FastifyInstance, deps: { contextFor: (cookie: string | undefined) => Context; signIn: SignInWay }): void {
  acceptForms(server);

  /** Renders a step as the caller; a refusal shows the step it came from again, with why, or asks to sign in. */
  const answer = async (
    exchange: { request: FastifyRequest; reply: FastifyReply },
    step: { render: (caller: ReturnType<typeof gatewayRouter.createCaller>) => FastifyReply | Promise<FastifyReply>; refused: (message: string) => string },
  ) => {
    const { request, reply } = exchange;
    const context = deps.contextFor(request.headers.cookie);
    const actor = await context.authenticateActor({ cookie: context.cookie, crewToken: context.crewToken });
    const isSignedIn = actor.isOk && actor.value.kind === 'account';
    try {
      if (!actor.isOk) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: actor.error.message });
      }
      return await step.render(gatewayRouter.createCaller(context));
    } catch (error) {
      if (!(error instanceof TRPCError)) {
        throw error;
      }
      if (error.code === 'UNAUTHORIZED') {
        return reply.code(getHTTPStatusCodeFromError(error)).type('text/html; charset=utf-8').send(signalPage({ title: TITLE, body: signInPrompt({ message: error.message, way: deps.signIn, returnTo: PAGE }) }));
      }
      const isInternal = error.code === 'INTERNAL_SERVER_ERROR';
      return html(reply, { status: isInternal ? HTTP_INTERNAL_ERROR : getHTTPStatusCodeFromError(error), body: step.refused(isInternal ? 'Internal error' : error.message), isSignedIn });
    }
  };

  const formOf = (request: FastifyRequest): Form => {
    const form = formSchema.safeParse(request.body);
    return form.success ? form.data : {};
  };

  server.get(PAGE, (request, reply) =>
    answer(
      { request, reply },
      {
        render: () => html(reply, { status: 200, body: addressBody({}), isSignedIn: true }),
        refused: (message) => addressBody({}, message),
      },
    ),
  );

  server.post(`${PAGE}/check`, (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
    }
    const form = formOf(request);
    return answer(
      { request, reply },
      {
        render: async (caller) => {
          const { tools } = await caller.parties.check({ url: field(form, 'url'), credential: credentialOf(form) });
          return html(reply, { status: 200, body: ownerBody(form, { tools }), isSignedIn: true });
        },
        refused: (message) => addressBody(form, message),
      },
    );
  });

  server.post(PAGE, (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
    }
    const form = formOf(request);
    return answer(
      { request, reply },
      {
        render: async (caller) => {
          const ownerShipId = idSchema('ship').safeParse(field(form, 'ownerShipId').trim());
          if (!ownerShipId.success) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: "The owner's ship id is not a ship id (shp_...)" });
          }
          const approved = await caller.parties.approve({
            requestId: field(form, 'requestId'),
            name: field(form, 'name'),
            url: field(form, 'url'),
            credential: credentialOf(form),
            ownerShipId: ownerShipId.data,
            concurrencyLimit: Number(field(form, 'concurrencyLimit')),
          });
          return reply.code(HTTP_SEE_OTHER).header('location', `${LIST}/${encodeURIComponent(approved.name)}`).send();
        },
        refused: (message) => ownerBody(form, { refusal: message }),
      },
    );
  });
}
