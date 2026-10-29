/**
 * What the gateway's doors share for a browser: forms, and the check that
 * a form came from the gateway's own pages.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** A form from the gateway's own pages: its Origin is the gateway's, so no other site can send one with argo's cookie. */
export function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return false;
  }
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/** Parses form posts into their fields, once per server whichever page asks first. */
export function acceptForms(server: FastifyInstance): void {
  if (!server.hasContentTypeParser('application/x-www-form-urlencoded')) {
    // eslint-disable-next-line @typescript-eslint/max-params -- Fastify's parser signature.
    server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
  }
}
