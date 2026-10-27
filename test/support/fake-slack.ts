/**
 * Slack in a test (gateway scopes, part B's Slack double): its Web API
 * methods the gateway calls, at /api/<method>, as Slack answers them. A
 * configuration refresh token is good once, and turns into the next pair;
 * a made app's install screen (/oauth/v2/authorize) sends the person
 * straight back to the app's redirect address with a code, as when they
 * press Allow; the code is good once for that app's bot token. Sign in with
 * Slack (/openid/connect/authorize) sends the person back the same way, as
 * the Slack user the test signs in as. The test refuses tokens, rate limits
 * a method, or reads what was asked and what was posted.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface FakeSlack {
  url: string;
  /** Slack's Web API base, as the gateway's SLACK_API_URL names it. */
  apiUrl: string;
  /** Issues a configuration refresh token Slack takes once. */
  issueRefreshToken(refreshToken: string): void;
  /** The apps made, by id, with the manifest each was made from and whether it was removed. */
  apps: Map<string, { manifest: unknown; isRemoved: boolean }>;
  /** Each rotation Slack answered, in order. */
  rotations: number;
  /** Who Sign in with Slack signs in as next, in the workspace given (Slack's own unless named). */
  signInAs(user: { userId: string; name: string; teamId?: string }): void;
  /** Each message only one person sees, as posted with a bot token. */
  postedOnlyTo: { botToken: string; form: Record<string, string> }[];
  /** Answers the method 429 with this Retry-After, until cleared. */
  rateLimit(method: string, retryAfterSeconds: number | undefined): void;
  stop(): Promise<void>;
}

/** The workspace every token and install is of. */
export const SLACK_TEAM = { id: 'T0ACME', name: 'Acme' };

async function bodyOf(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function answer(response: ServerResponse, reply: { body: unknown; status?: number; headers?: Record<string, string> }): void {
  response.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers }).end(JSON.stringify(reply.body));
}

function redirectUrlsOf(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null || !('oauth_config' in manifest)) {
    return [];
  }
  const { oauth_config: oauthConfig } = manifest;
  if (typeof oauthConfig !== 'object' || oauthConfig === null || !('redirect_urls' in oauthConfig) || !Array.isArray(oauthConfig.redirect_urls)) {
    return [];
  }
  const urls: unknown[] = oauthConfig.redirect_urls;
  return urls.filter((url) => typeof url === 'string');
}

/** Where an install goes back: the app's first redirect address. */
function redirectUrlOf(manifest: unknown): string | undefined {
  return redirectUrlsOf(manifest)[0];
}

export async function startFakeSlack(): Promise<FakeSlack> {
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();
  const apps = new Map<string, { manifest: unknown; isRemoved: boolean }>();
  const codes = new Map<string, string>();
  const rateLimits = new Map<string, number>();
  const signInCodes = new Map<string, { appId: string; userId: string; name: string; teamId: string }>();
  const userTokens = new Map<string, { userId: string; name: string; teamId: string }>();
  const postedOnlyTo = new Array<{ botToken: string; form: Record<string, string> }>();
  let signingInAs = { userId: 'U0MATHILDE', name: 'mathilde', teamId: SLACK_TEAM.id };
  let rotations = 0;
  let base = '';

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', base);
    if (url.pathname === '/oauth/v2/authorize') {
      const appId = url.searchParams.get('client_id')?.replace(/^client-/, '') ?? '';
      const app = apps.get(appId);
      const redirectUrl = app === undefined ? undefined : redirectUrlOf(app.manifest);
      if (redirectUrl === undefined) {
        response.writeHead(404).end();
        return;
      }
      const code = `code-${appId}-${String(codes.size + 1)}`;
      codes.set(code, appId);
      const back = new URL(redirectUrl);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (url.pathname === '/openid/connect/authorize') {
      const appId = url.searchParams.get('client_id')?.replace(/^client-/, '') ?? '';
      const app = apps.get(appId);
      const redirectUrl = url.searchParams.get('redirect_uri') ?? '';
      if (app === undefined || !redirectUrlsOf(app.manifest).includes(redirectUrl) || url.searchParams.get('scope') !== 'openid profile') {
        response.writeHead(400).end();
        return;
      }
      const code = `signin-${appId}-${String(signInCodes.size + 1)}`;
      signInCodes.set(code, { appId, ...signingInAs });
      const back = new URL(redirectUrl);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }
    const method = url.pathname.replace(/^\/api\//, '');
    const form = await bodyOf(request);
    const retryAfter = rateLimits.get(method);
    if (retryAfter !== undefined) {
      answer(response, { body: { ok: false, error: 'ratelimited' }, status: 429, headers: { 'retry-after': String(retryAfter) } });
      return;
    }
    const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    switch (method) {
      case 'tooling.tokens.rotate': {
        const refreshToken = form.get('refresh_token') ?? '';
        if (!refreshTokens.delete(refreshToken)) {
          answer(response, { body: { ok: false, error: 'invalid_refresh_token' } });
          return;
        }
        rotations += 1;
        const token = `xoxe.xoxp-1-${String(rotations)}`;
        const next = `xoxe-1-rotated-${String(rotations)}`;
        accessTokens.add(token);
        refreshTokens.add(next);
        const iat = Math.floor(Date.now() / 1000);
        answer(response, { body: { ok: true, token, refresh_token: next, team_id: SLACK_TEAM.id, user_id: 'U0CHARLOTTE', iat, exp: iat + 12 * 60 * 60 } });
        return;
      }
      case 'apps.manifest.create': {
        if (!accessTokens.has(bearer)) {
          answer(response, { body: { ok: false, error: 'invalid_auth' } });
          return;
        }
        const manifest: unknown = JSON.parse(form.get('manifest') ?? 'null');
        const appId = `A0${String(apps.size + 1)}`;
        apps.set(appId, { manifest, isRemoved: false });
        answer(response, {
          body: {
            ok: true,
            app_id: appId,
            credentials: { client_id: `client-${appId}`, client_secret: `secret-${appId}`, verification_token: 'unused', signing_secret: `signing-${appId}` },
            oauth_authorize_url: `${base}/oauth/v2/authorize?client_id=client-${appId}&scope=chat%3Awrite`,
          },
        });
        return;
      }
      case 'apps.manifest.update': {
        const app = apps.get(form.get('app_id') ?? '');
        if (!accessTokens.has(bearer) || app === undefined || app.isRemoved) {
          answer(response, { body: { ok: false, error: accessTokens.has(bearer) ? 'app_not_found' : 'invalid_auth' } });
          return;
        }
        app.manifest = JSON.parse(form.get('manifest') ?? 'null');
        answer(response, { body: { ok: true, app_id: form.get('app_id'), permissions_updated: false } });
        return;
      }
      case 'apps.manifest.delete': {
        const app = apps.get(form.get('app_id') ?? '');
        if (!accessTokens.has(bearer) || app === undefined || app.isRemoved) {
          answer(response, { body: { ok: false, error: accessTokens.has(bearer) ? 'app_not_found' : 'invalid_auth' } });
          return;
        }
        app.isRemoved = true;
        answer(response, { body: { ok: true } });
        return;
      }
      case 'oauth.v2.access': {
        const code = form.get('code') ?? '';
        const appId = codes.get(code);
        if (appId === undefined || form.get('client_id') !== `client-${appId}` || form.get('client_secret') !== `secret-${appId}`) {
          answer(response, { body: { ok: false, error: 'invalid_code' } });
          return;
        }
        codes.delete(code);
        answer(response, { body: { ok: true, access_token: `xoxb-${appId}`, token_type: 'bot', bot_user_id: `U0${appId}`, app_id: appId, team: SLACK_TEAM } });
        return;
      }
      case 'openid.connect.token': {
        const code = form.get('code') ?? '';
        const signedIn = signInCodes.get(code);
        if (signedIn === undefined || form.get('client_id') !== `client-${signedIn.appId}` || form.get('client_secret') !== `secret-${signedIn.appId}`) {
          answer(response, { body: { ok: false, error: 'invalid_code' } });
          return;
        }
        signInCodes.delete(code);
        const token = `xoxp-${signedIn.userId}`;
        userTokens.set(token, signedIn);
        answer(response, { body: { ok: true, access_token: token, token_type: 'Bearer', id_token: 'unused' } });
        return;
      }
      case 'openid.connect.userInfo': {
        const user = userTokens.get(bearer);
        if (user === undefined) {
          answer(response, { body: { ok: false, error: 'invalid_auth' } });
          return;
        }
        answer(response, { body: { ok: true, sub: user.userId, 'https://slack.com/user_id': user.userId, 'https://slack.com/team_id': user.teamId, name: user.name } });
        return;
      }
      case 'chat.postEphemeral': {
        if (!bearer.startsWith('xoxb-')) {
          answer(response, { body: { ok: false, error: 'invalid_auth' } });
          return;
        }
        postedOnlyTo.push({ botToken: bearer, form: Object.fromEntries(form) });
        answer(response, { body: { ok: true, message_ts: '1730019600.000100' } });
        return;
      }
      default:
        answer(response, { body: { ok: false, error: 'unknown_method' }, status: 404 });
    }
  };

  const server: Server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
  return {
    url: base,
    apiUrl: `${base}/api`,
    issueRefreshToken: (refreshToken) => refreshTokens.add(refreshToken),
    signInAs: (user) => {
      signingInAs = { teamId: SLACK_TEAM.id, ...user };
    },
    postedOnlyTo,
    apps,
    get rotations() {
      return rotations;
    },
    rateLimit: (method, retryAfterSeconds) => {
      if (retryAfterSeconds === undefined) {
        rateLimits.delete(method);
      } else {
        rateLimits.set(method, retryAfterSeconds);
      }
    },
    stop: () => new Promise<void>((resolve) => server.close(() => { resolve(); })),
  };
}
