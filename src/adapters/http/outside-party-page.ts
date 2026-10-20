/**
 * One outside party, on its own page (design B, Signal, screens 12 and 14):
 * the handshake of party and fleet, its proxy ship's state, then its facts
 * as the fleet holds them: proxy ship, owner and scopes (decision 0056).
 * An actor holding fleet:manage retires it, after one confirm that lists
 * what happens. Each page calls the gateway's own API as the caller, so it
 * checks nothing the API does not; it shows Retire only to an actor holding
 * its scope and refuses a form sent from another origin.
 */
import { TRPCError, type inferRouterOutputs } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { RETIRING_SCOPE } from '../../core/parties/retire-party.js';
import { gatewayRouter, type Context, type GatewayRouter } from '../trpc/router.js';
import { acceptForms, escaped, isSameOrigin } from './html.js';
import { PARTY_KINDS, PARTY_STATES, SIDES } from './outside-parties-page.js';
import { handshake, icon, ring, signalPage, signInPrompt, statusBadge, type SignInWay } from './signal.js';

/** An outside party as the API shows it. */
type ListedParty = inferRouterOutputs<GatewayRouter>['parties']['get'];

const HTTP_FORBIDDEN = 403;
const HTTP_SEE_OTHER = 303;
const HTTP_INTERNAL_ERROR = 500;

const LIST = '/outside-parties';
const TITLE = 'Outside parties';

function partyPath(name: string, action?: 'retire'): string {
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

function facts(party: ListedParty): string {
  const where = party.kind === 'mcpServer' ? { label: 'Address', value: party.url } : { label: 'Client id', value: party.clientId };
  const scopes = party.scopes === null ? UNKNOWN : party.scopes.map((scope) => `<span class="tag mono">${escaped(scope)}</span>`).join('');
  return `<dl class="fact-rows">${[
    fact({ icon: 'ship', label: 'Proxy ship', value: party.proxyShipId === null ? UNKNOWN : `<span class="mono">${escaped(party.proxyShipId)}</span>` }),
    fact({ icon: 'users', label: 'Owner', value: party.ownerShipId === null ? UNKNOWN : `<span class="mono">${escaped(party.ownerShipId)}</span>` }),
    fact({ icon: 'shield', label: 'Scopes', value: scopes }),
    fact({ icon: SIDES[PARTY_KINDS[party.kind].side].icon, label: where.label, value: `<span class="mono">${escaped(where.value)}</span>` }),
  ].join('')}</dl>`;
}

function partyBody(party: ListedParty, shown: { canRetire: boolean; refusal?: string }): string {
  const refusal = shown.refusal === undefined ? '' : `<section class="card alert tone-attention" role="alert"><p>${escaped(shown.refusal)}</p></section>`;
  const retire = shown.canRetire ? `<div class="actions"><a class="button" href="${partyPath(party.name, 'retire')}">${icon('archive', 14)}Retire ${escaped(party.name)}…</a></div>` : '';
  return [BACK, head(party), refusal, facts(party), retire].join('');
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
    render: (shown: { caller: ReturnType<typeof gatewayRouter.createCaller>; canRetire: boolean; isSignedIn: boolean }) => Promise<FastifyReply>,
  ) => {
    const { request, reply } = exchange;
    const context = deps.contextFor(request.headers.cookie);
    const caller = gatewayRouter.createCaller(context);
    const actor = await context.authenticateActor({ cookie: context.cookie, crewToken: context.crewToken });
    const canRetire = actor.isOk && actor.value.scopes.includes(RETIRING_SCOPE);
    const isSignedIn = actor.isOk && actor.value.kind === 'account';
    try {
      return await render({ caller, canRetire, isSignedIn });
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
        return html(reply, { status, body: partyBody(party, { canRetire, refusal }), isSignedIn });
      }
      return html(reply, { status, body: `${BACK}<section class="card alert tone-attention" role="alert"><p>${escaped(refusal)}</p></section>`, isSignedIn });
    }
  };

  server.get<{ Params: { name: string } }>(`${LIST}/:name`, (request, reply) =>
    answer({ request, reply }, async ({ caller, canRetire, isSignedIn }) => html(reply, { status: 200, body: partyBody(await caller.parties.get({ name: request.params.name }), { canRetire }), isSignedIn })),
  );
  server.get<{ Params: { name: string } }>(`${LIST}/:name/retire`, (request, reply) =>
    answer({ request, reply }, async ({ caller, isSignedIn }) => html(reply, { status: 200, body: retireBody(await caller.parties.get({ name: request.params.name })), isSignedIn })),
  );
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
