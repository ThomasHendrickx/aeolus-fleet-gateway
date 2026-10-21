/**
 * The gateway's address as a person opens it: the address itself sends them
 * to the Overview, and an address with no page answers a page in the
 * gateway's look. A client that calls an unknown address (no page asked
 * for: not a GET that accepts HTML) gets Fastify's JSON answer as before.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { signalPage } from './signal.js';

const HTTP_SEE_OTHER = 303;
const HTTP_NOT_FOUND = 404;

const OVERVIEW = '/overview';

/** Whether a browser asks for a page: a GET (or HEAD) that accepts HTML. */
function isPageAsked(request: FastifyRequest): boolean {
  return (request.method === 'GET' || request.method === 'HEAD') && (request.headers.accept ?? '').includes('text/html');
}

export function registerFrontDoor(server: FastifyInstance): void {
  server.get('/', (_request, reply) => reply.code(HTTP_SEE_OTHER).header('location', OVERVIEW).send());

  server.setNotFoundHandler((request, reply) => {
    if (!isPageAsked(request)) {
      return reply.code(HTTP_NOT_FOUND).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: HTTP_NOT_FOUND });
    }
    const body = `<section class="card"><h2>This page does not exist</h2><div class="actions"><a class="button" href="${OVERVIEW}">Go to the Overview</a></div></section>`;
    return reply.code(HTTP_NOT_FOUND).type('text/html; charset=utf-8').send(signalPage({ title: 'Not found', body }));
  });
}
