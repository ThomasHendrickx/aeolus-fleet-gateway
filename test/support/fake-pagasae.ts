/**
 * pagasae in a test, as the gateway's OpenID Connect provider: its
 * authorize address sends the person straight back with a code, as for an
 * account with one fleet, and its token endpoint redeems that code once,
 * for the gateway's secret and the verifier of the challenge, with an
 * account token for the fleet the test names. The token is not signed: the
 * gateway reads it, and only core checks signatures.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

export const PAGASAE_CLIENT = { clientId: 'gateway', clientSecret: 'a-pagasae-client-secret-for-the-gateway' };

export interface FakePagasae {
  url: string;
  /** The account token claims the next redeemed code answers. */
  answer(claims: Record<string, unknown>): void;
  stop(): Promise<void>;
}

async function formOf(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function anAccountToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'EdDSA', typ: 'at+jwt', kid: 'test' })}.${part(claims)}.dW5zaWduZWQ`;
}

export async function startFakePagasae(): Promise<FakePagasae> {
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  let claims: Record<string, unknown> = {};
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://pagasae.test');
    if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
      const code = `code-${String(codes.size + 1)}`;
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      void formOf(request).then((form) => {
        const held = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const isValid =
          held !== undefined &&
          form.get('client_id') === PAGASAE_CLIENT.clientId &&
          form.get('client_secret') === PAGASAE_CLIENT.clientSecret &&
          form.get('redirect_uri') === held.redirectUri &&
          createHash('sha256').update(verifier).digest('base64url') === held.challenge;
        if (!isValid) {
          response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ access_token: anAccountToken(claims), token_type: 'Bearer', expires_in: 600, refresh_token: 'pagasae-refresh-1', id_token: 'id' }));
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`,
    answer: (next) => {
      claims = next;
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
