import { z } from 'zod';

/** The shortest installation token the gateway takes, as the server does (decision 0020). */
const INSTALLATION_TOKEN_MIN_LENGTH = 32;

/** The shortest gateway secret: 32 characters, as long as the HMAC keys it makes. */
const GATEWAY_SECRET_MIN_LENGTH = 32;

/** How long an MCP client's call waits for its answer unless set (Q13). */
export const MCP_WAIT_MAX_MS_DEFAULT = 10_000;

/** The email channel's window unless set: at most one wake per hour (wake a person, W10). */
const EMAIL_WAKE_WINDOW_MINUTES_DEFAULT = 60;

/** Web push's window unless set: at most one wake per 10 minutes (wake a person, W10). */
const WEB_PUSH_WAKE_WINDOW_MINUTES_DEFAULT = 10;

const MINUTE_MS = 60_000;

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }),
  FLEET_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }),
  GATEWAY_SECRET: z.string().min(GATEWAY_SECRET_MIN_LENGTH, { error: `must hold at least ${String(GATEWAY_SECRET_MIN_LENGTH)} characters` }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4200),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  GATEWAY_PUBLIC_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }).optional(),
  MCP_WAIT_MAX_MS: z.coerce.number().int().min(0).default(MCP_WAIT_MAX_MS_DEFAULT),
  EMAIL_WAKE_WINDOW_MINUTES: z.coerce.number().int().min(1).default(EMAIL_WAKE_WINDOW_MINUTES_DEFAULT),
  WEB_PUSH_WAKE_WINDOW_MINUTES: z.coerce.number().int().min(1).default(WEB_PUSH_WAKE_WINDOW_MINUTES_DEFAULT),
  WEB_PUSH_PUBLIC_KEY: z.string().min(1).optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().min(1).optional(),
  WEB_PUSH_SUBJECT: z.string().min(1).optional(),
  INSTALLATION_TOKEN: z.string().min(INSTALLATION_TOKEN_MIN_LENGTH, { error: `must hold at least ${String(INSTALLATION_TOKEN_MIN_LENGTH)} characters` }).optional(),
  PAGASAE_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }).optional(),
  PAGASAE_CLIENT_ID: z.string().min(1).optional(),
  PAGASAE_CLIENT_SECRET: z.string().min(1).optional(),
  PAGASAE_APP_CLIENT_ID: z.string().min(1).optional(),
  PAGASAE_APP_CLIENT_SECRET: z.string().min(1).optional(),
  SLACK_API_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }).default('https://slack.com/api'),
  OPENAI_APPS_CHALLENGE: z.string().min(1).optional(),
});

/** What `aeolus-gateway migrate` reads: the database alone. */
const databaseEnvironmentSchema = environmentSchema.pick({ DATABASE_URL: true });

export interface Config {
  /** The gateway's own database, which may share the fleet's Postgres server. */
  databaseUrl: string;
  /** The fleet's public URL, where the gateway calls the ship contract as the ships it crews. */
  fleetUrl: string;
  host: string;
  port: number;
  logLevel: string;
  /**
   * The token a hosting service presents to the installation procedures
   * (decision 0021). Unset, they are off and every fleet is served, as a
   * self-hosted gateway needs; set, a fleet is served once switched on.
   */
  installationToken: string | undefined;
  /**
   * Where outside MCP clients reach the gateway: the OAuth issuer, with the
   * MCP endpoint below it. This machine at the gateway's port unless set.
   */
  publicUrl: string;
  /**
   * Where the web app's server calls the gateway's API: this machine at the
   * gateway's port, never an address a request names, so a page forwards a
   * browser's cookies only to the gateway itself.
   */
  apiUrl: string;
  /** Keys what the gateway derives: ship aliases, result handles and idempotency keys. Changing it renames every ship to outside clients. */
  gatewaySecret: string;
  /** How long an outside MCP client's call waits for its answer before it is answered its handle. */
  mcpWaitMaxMs: number;
  /** The least time between two wakes the email channel sends one person ship (wake a person, W3, W10). */
  emailWakeWindowMs: number;
  /**
   * The gateway's push keys (VAPID), which sign each web push wake, and the
   * subject a push service may contact about them, a mailto: or https: URL.
   * Unset, the overview offers no web push (wake a person, S3).
   */
  webPush: { publicKey: string; privateKey: string; subject: string } | undefined;
  /** The least time between two wakes web push sends one person ship (wake a person, W3, W10). */
  webPushWakeWindowMs: number;
  /**
   * pagasae, where people sign in (decision 0054), and the gateway's client
   * there, registered with the redirect URI `<public URL>/pagasae/callback`.
   * Unset, people do not sign in, and argo alone approves clients.
   */
  pagasae: { url: string; clientId: string; clientSecret: string } | undefined;
  /**
   * The gateway's pages as an app at pagasae (its APP_CLIENTS), with the
   * redirect URI `<public URL>/sign-in/done`: people sign in to the pages
   * with the account sign-in every Aeolus app shares (header design H5).
   * Unset, nobody signs in to them that way.
   */
  pagasaeApp: { clientId: string; clientSecret: string } | undefined;
  /** Slack's Web API, where the gateway makes and installs Slack bots (gateway scopes, part B): Slack's own unless set. */
  slackApiUrl: string;
  /**
   * The token OpenAI's plugin portal shows to prove the gateway's domain,
   * served at /.well-known/openai-apps-challenge (chatgpt-plugin design,
   * 7.5). Unset, there is no such address.
   */
  openAiAppsChallenge: string | undefined;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parsed<T>(schema: z.ZodType<T>, environment: Record<string, string | undefined>): T {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
  }
  return result.data;
}

/** The configuration from the environment; throws a ConfigError naming every variable that is wrong. */
export function loadConfig(environment: Record<string, string | undefined>): Config {
  const variables = parsed(environmentSchema, environment);
  return {
    databaseUrl: variables.DATABASE_URL,
    fleetUrl: variables.FLEET_URL.replace(/\/$/, ''),
    host: variables.HOST,
    port: variables.PORT,
    logLevel: variables.LOG_LEVEL,
    installationToken: variables.INSTALLATION_TOKEN,
    publicUrl: (variables.GATEWAY_PUBLIC_URL ?? `http://127.0.0.1:${String(variables.PORT)}`).replace(/\/$/, ''),
    apiUrl: `http://127.0.0.1:${String(variables.PORT)}`,
    gatewaySecret: variables.GATEWAY_SECRET,
    mcpWaitMaxMs: variables.MCP_WAIT_MAX_MS,
    emailWakeWindowMs: variables.EMAIL_WAKE_WINDOW_MINUTES * MINUTE_MS,
    webPush: webPushOf(variables),
    webPushWakeWindowMs: variables.WEB_PUSH_WAKE_WINDOW_MINUTES * MINUTE_MS,
    pagasae: pagasaeOf(variables),
    pagasaeApp: pagasaeAppOf(variables),
    slackApiUrl: variables.SLACK_API_URL.replace(/\/$/, ''),
    openAiAppsChallenge: variables.OPENAI_APPS_CHALLENGE,
  };
}

/** pagasae's three settings: all of them, or none. */
function pagasaeOf(variables: { PAGASAE_URL?: string | undefined; PAGASAE_CLIENT_ID?: string | undefined; PAGASAE_CLIENT_SECRET?: string | undefined }): Config['pagasae'] {
  const { PAGASAE_URL: url, PAGASAE_CLIENT_ID: clientId, PAGASAE_CLIENT_SECRET: clientSecret } = variables;
  if (url === undefined && clientId === undefined && clientSecret === undefined) {
    return undefined;
  }
  if (url === undefined || clientId === undefined || clientSecret === undefined) {
    throw new ConfigError('PAGASAE_URL, PAGASAE_CLIENT_ID and PAGASAE_CLIENT_SECRET: set all three, or none');
  }
  return { url: url.replace(/\/$/, ''), clientId, clientSecret };
}

/** The pages' app client: both settings, or neither, and only beside pagasae. */
function pagasaeAppOf(variables: { PAGASAE_URL?: string | undefined; PAGASAE_APP_CLIENT_ID?: string | undefined; PAGASAE_APP_CLIENT_SECRET?: string | undefined }): Config['pagasaeApp'] {
  const { PAGASAE_URL: url, PAGASAE_APP_CLIENT_ID: clientId, PAGASAE_APP_CLIENT_SECRET: clientSecret } = variables;
  if (clientId === undefined && clientSecret === undefined) {
    return undefined;
  }
  if (url === undefined || clientId === undefined || clientSecret === undefined) {
    throw new ConfigError('PAGASAE_APP_CLIENT_ID and PAGASAE_APP_CLIENT_SECRET: set both beside PAGASAE_URL, or neither');
  }
  return { clientId, clientSecret };
}

/** Web push's three settings: all of them, or none. */
function webPushOf(variables: { WEB_PUSH_PUBLIC_KEY?: string | undefined; WEB_PUSH_PRIVATE_KEY?: string | undefined; WEB_PUSH_SUBJECT?: string | undefined }): Config['webPush'] {
  const { WEB_PUSH_PUBLIC_KEY: publicKey, WEB_PUSH_PRIVATE_KEY: privateKey, WEB_PUSH_SUBJECT: subject } = variables;
  if (publicKey === undefined && privateKey === undefined && subject === undefined) {
    return undefined;
  }
  if (publicKey === undefined || privateKey === undefined || subject === undefined) {
    throw new ConfigError('WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT: set all three, or none');
  }
  return { publicKey, privateKey, subject };
}

/** The database URL alone, for `aeolus-gateway migrate`. */
export function loadDatabaseUrl(environment: Record<string, string | undefined>): string {
  return parsed(databaseEnvironmentSchema, environment).DATABASE_URL;
}
