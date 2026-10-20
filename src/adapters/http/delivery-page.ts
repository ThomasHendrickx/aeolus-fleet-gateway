/**
 * A delivery that waits on a person, opened from the Overview (design B,
 * Signal): one item in focus. Opening is the person's own act, so it is a
 * form, never a link: the gateway acknowledges the delivery for them, and
 * the page shows it whole once. A question is answered with one tap on a
 * button that names the option it sends, the asker's pick on a dashed edge;
 * any delivery may get a note as its answer, or be done with. Each form
 * calls the gateway's own API as the person.
 */
import { ANSWER_CONTENT_TYPE, answerSchema, isQuestionContentType, questionSchema, type Question } from '@aeolus-fleet/common';
import { TRPCError, type inferRouterOutputs } from '@trpc/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { gatewayRouter, type Context, type GatewayRouter } from '../trpc/router.js';
import { escaped, isSameOrigin } from './html.js';
import { icon, signalPage } from './signal.js';

/** A delivery as the person opened it. */
type OpenedView = inferRouterOutputs<GatewayRouter>['people']['open'];

/** Where the person goes once a delivery is dealt with, or when it no longer waits. */
export const OVERVIEW = '/overview';

const HTTP_FORBIDDEN = 403;
const HTTP_SEE_OTHER = 303;

const TITLE = 'Overview';

const formSchema = z.record(z.string(), z.string());

function deliveryPath(deliveryId: string, action: 'open' | 'answer' | 'done'): string {
  return `${OVERVIEW}/deliveries/${encodeURIComponent(deliveryId)}/${action}`;
}

/** A delivery the inbox lists, as the Overview shows it: opening it is a form, as it acknowledges the delivery. */
export function waitingItem(entry: { deliveryId: string; from: string; title: string }): string {
  return `<form method="post" action="${deliveryPath(entry.deliveryId, 'open')}"><button class="item"><span class="text"><span>${escaped(entry.title)}</span><span class="tag">${icon('users', 12)}${escaped(entry.from)}</span></span></button></form>`;
}

function parsedQuestion(opened: OpenedView): Question | undefined {
  if (!isQuestionContentType(opened.contentType)) {
    return undefined;
  }
  try {
    const question = questionSchema.safeParse(JSON.parse(opened.payload));
    return question.success ? question.data : undefined;
  } catch {
    return undefined;
  }
}

const NOTE_FIELD = '<label class="field"><span>Note</span><textarea name="note" rows="2" placeholder="Optional, sent with your answer"></textarea></label>';

function questionCard(opened: OpenedView, question: Question): string {
  const picked = question.options.find((option) => option.key === question.pick.option);
  const buttons = question.options
    .map((option) => {
      const isPick = option.key === question.pick.option;
      return `<button class="${isPick ? 'primary pick' : ''}" name="option" value="${String(option.key)}" title="${escaped(option.detail)}">${icon(isPick ? 'check' : 'x', 14)}${escaped(option.label)}</button>`;
    })
    .join('');
  const pickLine = picked === undefined ? '' : `<p class="muted">${escaped(picked.label)} is the pick of ${escaped(opened.from)}: ${escaped(question.pick.why)}</p>`;
  return `<form method="post" action="${deliveryPath(opened.deliveryId, 'answer')}" style="display:grid;gap:12px"><input type="hidden" name="questionId" value="${escaped(question.id)}">
<p class="payload">${escaped(question.context)}</p>
<div class="answers">${buttons}</div>${pickLine}${NOTE_FIELD}<div class="actions"><button name="option" value="">Send the note alone</button></div></form>`;
}

function messageCard(opened: OpenedView): string {
  return `<pre class="payload">${escaped(opened.payload)}</pre>
<form method="post" action="${deliveryPath(opened.deliveryId, 'answer')}" style="display:grid;gap:12px">${NOTE_FIELD.replace('Optional, sent with your answer', 'Your answer')}<div class="actions"><button class="primary">Answer</button></div></form>
<form method="post" action="${deliveryPath(opened.deliveryId, 'done')}"><div class="actions"><button>${icon('check', 14)}Done</button></div></form>`;
}

function deliveryBody(opened: OpenedView): string {
  const question = parsedQuestion(opened);
  const card = question === undefined ? messageCard(opened) : questionCard(opened, question);
  return `<section class="card"><span class="tag">${icon('users', 12)}${escaped(opened.from)} · ${escaped(new Date(opened.sentAt).toUTCString())}</span><h2>${escaped(question?.title ?? opened.title)}</h2>${card}</section>`;
}

/** The answer a form sends: an option and a note, or a note alone, for a question; a note as plain text otherwise. */
function answerOf(form: Record<string, string>): { contentType: string; payload: string } {
  const note = (form.note ?? '').trim();
  const questionId = form.questionId;
  if (questionId === undefined) {
    if (note === '') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Write your answer first' });
    }
    return { contentType: 'text/plain', payload: note };
  }
  const option = form.option ?? '';
  const answer = answerSchema.safeParse({ questionId, ...(option === '' ? {} : { option: Number(option) }), ...(note === '' ? {} : { note }) });
  if (!answer.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tap an option, or write a note' });
  }
  return { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify(answer.data) };
}

function html(reply: FastifyReply, page: { status: number; body: string }): FastifyReply {
  return reply.code(page.status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(signalPage({ title: TITLE, tab: 'overview', body: page.body, isSignedIn: true }));
}

/** How the Overview answers a page of its own: it renders as the caller, and says why the API refused, or asks to sign in. */
export type PageAnswer = (exchange: {
  request: FastifyRequest;
  reply: FastifyReply;
  render: (context: Context) => Promise<FastifyReply>;
  onRefused?: (context: Context, refused: { status: number; message: string }) => FastifyReply | Promise<FastifyReply>;
}) => Promise<FastifyReply>;

const HTTP_NOT_FOUND = 404;

function noLongerWaits(refused: { message: string }): string {
  return `<section class="card"><h2>This no longer waits for you</h2><p class="muted">${escaped(refused.message)}</p><div class="actions"><a class="button" href="${OVERVIEW}">Back to the overview</a></div></section>`;
}

/** The delivery forms, posted from the Overview, answered as the Overview answers its own pages. */
export function registerDeliveryPages(server: FastifyInstance, deps: { answer: PageAnswer }): void {
  const act = (action: 'open' | 'answer' | 'done', run: (exchange: { caller: ReturnType<typeof gatewayRouter.createCaller>; deliveryId: string; form: Record<string, string>; reply: FastifyReply }) => Promise<FastifyReply>) => {
    server.post<{ Params: { deliveryId: string } }>(`${OVERVIEW}/deliveries/:deliveryId/${action}`, (request, reply) => {
      if (!isSameOrigin(request)) {
        return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
      }
      const form = formSchema.safeParse(request.body);
      return deps.answer({
        request,
        reply,
        render: (context) => run({ caller: gatewayRouter.createCaller(context), deliveryId: request.params.deliveryId, form: form.success ? form.data : {}, reply }),
        onRefused: (_context, refused) =>
          html(reply, refused.status === HTTP_NOT_FOUND ? { status: refused.status, body: noLongerWaits(refused) } : { status: refused.status, body: `<section class="card alert tone-attention" role="alert"><p>${escaped(refused.message)}</p></section>` }),
      });
    });
  };

  act('open', async ({ caller, deliveryId, reply }) => html(reply, { status: 200, body: deliveryBody(await caller.people.open({ deliveryId })) }));
  act('answer', async ({ caller, deliveryId, form, reply }) => {
    await caller.people.answer({ deliveryId, ...answerOf(form) });
    return reply.code(HTTP_SEE_OTHER).header('location', OVERVIEW).send();
  });
  act('done', async ({ caller, deliveryId, reply }) => {
    await caller.people.done({ deliveryId });
    return reply.code(HTTP_SEE_OTHER).header('location', OVERVIEW).send();
  });
}
