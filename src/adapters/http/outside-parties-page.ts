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
import { gatewayRouter, type Context } from '../trpc/router.js';
import { acceptForms, escaped, isSameOrigin } from './html.js';
import { icon, ring, signalPage, statusBadge } from './signal.js';

const HTTP_FORBIDDEN = 403;
const HTTP_SEE_OTHER = 303;
const HTTP_INTERNAL_ERROR = 500;

const PAGE = '/outside-parties';
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

async function renderPage(reply: FastifyReply, page: { context: Context; status?: number; notice?: Notice }): Promise<FastifyReply> {
  const { context, notice } = page;
  const caller = gatewayRouter.createCaller(context);
  const { isOn } = await caller.outsideParties.status();
  const actor = await context.authenticateActor({ cookie: context.cookie, crewToken: context.crewToken });
  const canSwitch = actor.isOk && actor.value.scopes.includes(SWITCHING_SCOPE);
  const lead = `<div class="lead">${ring({ tone: isOn ? 'ok' : 'ended', center: { icon: isOn ? 'power' : 'powerOff' }, label: isOn ? 'On' : 'Off', isDashed: !isOn })}<h1>${TITLE}</h1></div>`;
  const body = [lead, notice ? noticeCard(notice) : '', switchCard({ isOn, canSwitch })].join('');
  return reply.code(page.status ?? 200).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(signalPage({ title: TITLE, tab: 'outsideParties', body }));
}

function signInPage(reply: FastifyReply, refusal: { fleetUrl: string; error: TRPCError }): FastifyReply {
  const { fleetUrl, error } = refusal;
  const body = `<section class="card"><h2>${escaped(error.message)}</h2><div class="actions"><a class="button" href="${escaped(fleetUrl)}">${icon('signIn', 14)}Sign in to the console of your fleet</a></div></section>`;
  return reply.code(getHTTPStatusCodeFromError(error)).type('text/html; charset=utf-8').send(signalPage({ title: TITLE, body }));
}

export function registerOutsidePartiesPage(server: FastifyInstance, deps: { contextFor: (cookie: string | undefined) => Context; fleetUrl: string }): void {
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
