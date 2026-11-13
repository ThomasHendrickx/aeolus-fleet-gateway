/**
 * pagasae in a test, as the gateway's OpenID Connect provider: its
 * authorize address sends the person straight back with a code, as for an
 * account with one fleet or one that chose its fleet, and its token
 * endpoint redeems that code once, for the gateway's secret and the
 * verifier of the challenge, with an account token for the fleet the test
 * names. Its tokens are signed with a key it publishes at
 * `/.well-known/jwks.json`, so a core given its URL as the account token
 * issuer checks them as it checks pagasae's (decision 0058). It refuses
 * every ID-JAG, as pagasae does for an account in several fleets (company
 * sign-in design, D9). It takes the
 * gateway's wakes (wake a person, W2) with the installation token the test
 * names, recording each, or answers them as the test scripts.
 */
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const PAGASAE_CLIENT = { clientId: 'gateway', clientSecret: 'a-pagasae-client-secret-for-the-gateway' };

/** The gateway's pages as an app at pagasae, for the shared account sign-in (header design H5). */
export const PAGASAE_APP_CLIENT = { clientId: 'gateway-pages', clientSecret: 'a-pagasae-app-client-secret-for-the-pages' };

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';

/** A fleet a shared sign-in lists, and whether the account may open the gateway there (header design H1: where it is on). */
export interface ListedFleet {
  readonly id: string;
  readonly name: string;
  /** False where the gateway is off for the fleet: pagasae then lists the console there instead. */
  readonly hasGateway?: boolean;
}

export interface FakePagasae {
  url: string;
  /** The account token claims the next redeemed code answers: the account's one fleet, or the one it chose. */
  answer(claims: Record<string, unknown>): void;
  /** Each request to its authorize address, in order, as the browser was sent there. */
  authorizeRequests: URL[];
  /**
   * A shared sign-in, as pagasae keeps it in its cookie on the shared
   * domain: it exchanges for these claims in the fleet they name, and lists
   * that fleet as Acme with the gateway, until it is revoked. Called again
   * with another fleet's claims, the same sign-in exchanges for each.
   */
  sharedSignIn(signIn: string, claims: Record<string, unknown>): void;
  /** Lists these fleets for a shared sign-in instead, with the gateway unless said otherwise, or answers its list with a server error. */
  listFor(signIn: string, listed: readonly ListedFleet[] | 'unavailable'): void;
  /** Each wake pagasae mailed, by the person ship it named, in order. */
  wakes: { fleetId: string; shipId: string }[];
  /** How many wakes it refused as answerWakes scripted. */
  readonly refusedWakes: number;
  /** Answers each wake to come with this status, mailing nothing, until answered again with 204. */
  answerWakes(status: number): void;
  stop(): Promise<void>;
}

/** The installation token the gateway presents to the fake pagasae's wakes. */
export const WAKE_INSTALLATION_TOKEN = 'an-installation-token-of-at-least-32-characters';

async function jsonOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function formOf(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export async function startFakePagasae(): Promise<FakePagasae> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = randomUUID();
  const keySet = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: keyId, alg: 'EdDSA', use: 'sig' }] };
  const anAccountToken = (claims: Record<string, unknown>): string => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${part({ alg: 'EdDSA', typ: 'at+jwt', kid: keyId })}.${part(claims)}`;
    return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
  };
  const authorizeRequests: URL[] = [];
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  /** How many codes it issued: each code is numbered by it, as a redeemed code leaves the map. */
  let issued = 0;
  let claims: Record<string, unknown> = {};
  /** Each shared sign-in's claims, by the fleet they name. */
  const signIns = new Map<string, Map<string, Record<string, unknown>>>();
  const listings = new Map<string, readonly ListedFleet[] | 'unavailable'>();
  const wakes: { fleetId: string; shipId: string }[] = [];
  let wakeStatus = 204;
  let refusedWakes = 0;
  const json = (response: ServerResponse, answer: { status: number; body: unknown }) => response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
  const isApp = (form: URLSearchParams) => form.get('client_id') === PAGASAE_APP_CLIENT.clientId && form.get('client_secret') === PAGASAE_APP_CLIENT.clientSecret;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://pagasae.test');
    if (request.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
      json(response, { status: 200, body: keySet });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
      authorizeRequests.push(url);
      issued += 1;
      const code = `code-${String(issued)}`;
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/apps') {
      const basic = `Basic ${Buffer.from(`${PAGASAE_APP_CLIENT.clientId}:${PAGASAE_APP_CLIENT.clientSecret}`).toString('base64')}`;
      const signIn = String(request.headers['aeolus-sign-in']);
      const held = signIns.get(signIn);
      const listed: readonly ListedFleet[] | 'unavailable' = listings.get(signIn) ?? [...(held?.keys() ?? [])].map((id) => ({ id, name: 'Acme' }));
      if (request.headers.authorization !== basic) {
        json(response, { status: 401, body: { error: 'invalid_client' } });
      } else if (held === undefined) {
        json(response, { status: 401, body: { error: 'invalid_grant' } });
      } else if (listed === 'unavailable') {
        json(response, { status: 503, body: { error: 'temporarily_unavailable' } });
      } else {
        const fleets = listed.map(({ id, name, hasGateway = true }) => ({ id, name, argo: false, apps: [hasGateway ? { app: 'gateway', url: 'http://gateway.test' } : { app: 'console', url: 'http://console.test' }] }));
        const account = String([...held.values()][0]?.sub);
        json(response, { status: 200, body: { account: { id: account, email: 'charlotte@example.com' }, apps: [{ app: 'account', url: `${url.origin}/account` }], fleets } });
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/wakes') {
      void jsonOf(request).then((body) => {
        if (request.headers.authorization !== `Bearer ${WAKE_INSTALLATION_TOKEN}`) {
          json(response, { status: 401, body: { error: 'invalid_token' } });
        } else if (wakeStatus !== 204) {
          refusedWakes += 1;
          json(response, { status: wakeStatus, body: { error: 'not_mailed' } });
        } else {
          const { fleetId, shipId } = typeof body === 'object' && body !== null && 'fleetId' in body && 'shipId' in body ? { fleetId: String(body.fleetId), shipId: String(body.shipId) } : { fleetId: '', shipId: '' };
          wakes.push({ fleetId, shipId });
          response.writeHead(204).end();
        }
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/revoke') {
      void formOf(request).then((form) => {
        if (!isApp(form)) {
          json(response, { status: 401, body: { error: 'invalid_client' } });
          return;
        }
        signIns.delete(form.get('token') ?? '');
        response.writeHead(200).end();
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      void formOf(request).then((form) => {
        if (form.get('grant_type') === TOKEN_EXCHANGE && form.get('subject_token_type') === ID_JAG_TOKEN_TYPE) {
          json(response, { status: 400, body: { error: 'invalid_grant', error_description: 'The account is in several fleets: there is no browser to ask which' } });
          return;
        }
        if (isApp(form) && form.get('grant_type') === TOKEN_EXCHANGE) {
          const inFleets = signIns.get(form.get('subject_token') ?? '');
          const held = inFleets?.get(form.get('resource') ?? '');
          if (inFleets === undefined) {
            json(response, { status: 400, body: { error: 'invalid_grant' } });
          } else if (held === undefined) {
            json(response, { status: 400, body: { error: 'invalid_target' } });
          } else {
            json(response, { status: 200, body: { access_token: anAccountToken(held), issued_token_type: 'urn:ietf:params:oauth:token-type:jwt', token_type: 'Bearer', expires_in: 600 } });
          }
          return;
        }
        if (isApp(form)) {
          const held = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? '');
          const isValid = form.get('redirect_uri') === held?.redirectUri && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === held.challenge;
          json(response, isValid ? { status: 200, body: { id_token: 'an-id-token', token_type: 'Bearer', expires_in: 600 } } : { status: 400, body: { error: 'invalid_grant' } });
          return;
        }
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
    authorizeRequests,
    sharedSignIn: (signIn, held) => {
      signIns.set(signIn, new Map([...(signIns.get(signIn) ?? []), [String(held.aud), held]]));
    },
    listFor: (signIn, listed) => {
      listings.set(signIn, listed);
    },
    wakes,
    get refusedWakes() {
      return refusedWakes;
    },
    answerWakes: (status) => {
      wakeStatus = status;
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Charlotte's account token claims in a fleet, as pagasae signs them. */
export function charlotteIn(pagasae: FakePagasae, fleet: string): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { iss: pagasae.url, aud: fleet, sub: 'acc-charlotte', org: 'org-acme', scope: 'fleet:read', group: ['sales'], iat: now, exp: now + 600 };
}
