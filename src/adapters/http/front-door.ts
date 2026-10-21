/**
 * The gateway's address as a person opens it: the address itself sends them
 * to the Overview, and the gateway's web app (Next.js, header design H3)
 * answers an address with no page of the server's own, its own files and its
 * pages' forms (server actions). A
 * client that calls an unknown address (no page asked for: not a GET that
 * accepts HTML) gets Fastify's JSON answer as before.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { isSameOrigin } from './html.js';

const HTTP_SEE_OTHER = 303;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const OVERVIEW = '/overview';

/** Where the web app's built files are served from. */
const WEB_APP_FILES = '/_next/*';

/** The header a server action of the web app (a page's form) is posted with: Next.js reads its body itself. */
const SERVER_ACTION_HEADER = 'next-action';

/** A form a page sends before its script took over the browser: the server has no form of its own of this kind. */
const PAGE_FORM_TYPE = 'multipart/form-data';

/** Whether a page of the web app sends one of its forms (a server action), with or without its script. */
function isPageForm(request: FastifyRequest): boolean {
  return request.method === 'POST' && (request.headers[SERVER_ACTION_HEADER] !== undefined || (request.headers['content-type'] ?? '').startsWith(PAGE_FORM_TYPE));
}

/** The web app's request handler: it answers the request it is handed, in full. */
export type WebApp = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/** Whether a browser asks for a page: a GET (or HEAD) that accepts HTML. */
function isPageAsked(request: FastifyRequest): boolean {
  return (request.method === 'GET' || request.method === 'HEAD') && (request.headers.accept ?? '').includes('text/html');
}

export function registerFrontDoor(server: FastifyInstance, deps: { web?: WebApp }): void {
  server.get('/', (_request, reply) => reply.code(HTTP_SEE_OTHER).header('location', OVERVIEW).send());

  const { web } = deps;
  if (web !== undefined) {
    // The web app writes the answer itself: Fastify, hijacked, sends nothing more.
    server.get(WEB_APP_FILES, async (request, reply) => {
      reply.hijack();
      await web(request.raw, reply.raw);
    });
    // Before any route or body parser: the web app reads the form's body as the browser sent it.
    server.addHook('onRequest', async (request, reply) => {
      if (isPageForm(request)) {
        // As the old pages did: a form comes from the gateway's own pages, never from another site with the browser's cookies.
        if (!isSameOrigin(request)) {
          return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('A form for this page is sent only from this page.');
        }
        reply.hijack();
        await web(request.raw, reply.raw);
      }
    });
  }

  server.setNotFoundHandler(async (request, reply) => {
    if (web === undefined || !isPageAsked(request)) {
      return reply.code(HTTP_NOT_FOUND).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: HTTP_NOT_FOUND });
    }
    reply.hijack();
    await web(request.raw, reply.raw);
  });
}
