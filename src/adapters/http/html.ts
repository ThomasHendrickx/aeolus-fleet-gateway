/**
 * What the gateway's server-rendered pages share: escaping, the page
 * layout and its style, forms, and the check that a form came from them.
 */
import type { TRPCError } from '@trpc/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

export function escaped(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const STYLE = `
:root { color-scheme: light dark; --ink: #1b1f24; --muted: #5b6470; --line: #d5dae0; --paper: #ffffff; --accent: #0b5cad; --warn: #a3261b; }
@media (prefers-color-scheme: dark) { :root { --ink: #e6e9ed; --muted: #9aa3ad; --line: #39414a; --paper: #14181c; --accent: #6aa8ec; --warn: #f08a7e; } }
body { margin: 0 auto; max-width: 960px; padding: 24px 16px; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }
h1 { font-size: 22px; } h2 { font-size: 17px; margin-top: 32px; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
form { display: grid; gap: 8px; margin: 8px 0; } form.inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
label { display: grid; gap: 2px; color: var(--muted); } input, select, button { font: inherit; padding: 6px 8px; }
button { color: var(--paper); background: var(--accent); border: 0; border-radius: 4px; cursor: pointer; }
.error { color: var(--warn); border: 1px solid var(--warn); padding: 8px 12px; border-radius: 4px; } .muted { color: var(--muted); }
`;

/** A whole page of the gateway's: its title, its body, and the shared style. */
export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaped(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

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

/** Why the API refused, as a page says it: the form's fields that are not valid, or the API's message. */
export function refusalMessage(error: TRPCError): string {
  if (error.cause instanceof z.ZodError) {
    return `The form is not valid: ${error.cause.issues.map((issue) => `${issue.path.join('.') || 'form'}: ${issue.message}`).join('; ')}`;
  }
  return error.code === 'INTERNAL_SERVER_ERROR' ? 'Internal error' : error.message;
}
