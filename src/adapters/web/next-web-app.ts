/**
 * The gateway's web app (header design H3, part 5): the Next.js app in
 * web/, beside the Fastify server and answered through it, so the gateway
 * keeps one address. Started from source it compiles as it is asked
 * (development); from the package it serves what `npm run build` built.
 */
import next from 'next';

import type { WebApp } from '../http/front-door.js';

/**
 * next's types, read under Node's module rules, put createServer on
 * `.default`; at run time `module.exports` is createServer itself
 * (next/dist/server/next.js), so the import is the function.
 */
const createServer: typeof next.default = typeof next === 'function' ? next : next.default;

/** Where the web app's server reads the gateway's API address from (web/lib/gateway-api/page-api.ts reads the same name). */
const API_URL_VARIABLE = 'AEOLUS_GATEWAY_API_URL';

export interface NextWebApp {
  handle: WebApp;
  close(): Promise<void>;
}

export async function startNextWebApp(options: { dir: string; isDevelopment: boolean; apiUrl: string }): Promise<NextWebApp> {
  // The web app runs in this process: its server reads where the API is when a page asks.
  process.env[API_URL_VARIABLE] = options.apiUrl;
  const app = createServer({ dir: options.dir, dev: options.isDevelopment });
  await app.prepare();
  const handle = app.getRequestHandler();
  return {
    handle: (request, response) => handle(request, response),
    close: () => app.close(),
  };
}
