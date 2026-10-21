/**
 * The gateway's address as a person opens it: the address itself sends them
 * to the Overview, and the gateway's web app (Next.js, header design H3)
 * answers an address with no page of the server's own, and its own files. A
 * client that calls an unknown address (no page asked for: not a GET that
 * accepts HTML) gets Fastify's JSON answer as before.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance, FastifyRequest } from 'fastify';

const HTTP_SEE_OTHER = 303;
const HTTP_NOT_FOUND = 404;

const OVERVIEW = '/overview';

/** Where the web app's built files are served from. */
const WEB_APP_FILES = '/_next/*';

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
  }

  server.setNotFoundHandler(async (request, reply) => {
    if (web === undefined || !isPageAsked(request)) {
      return reply.code(HTTP_NOT_FOUND).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: HTTP_NOT_FOUND });
    }
    reply.hijack();
    await web(request.raw, reply.raw);
  });
}
