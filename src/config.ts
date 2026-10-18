import { z } from 'zod';

const environmentSchema = z.object({
  FLEET_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4200),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  /** The fleet's public URL, where the gateway calls the ship contract as the ships it crews. */
  fleetUrl: string;
  host: string;
  port: number;
  logLevel: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** The configuration from the environment; throws a ConfigError naming every variable that is wrong. */
export function loadConfig(environment: Record<string, string | undefined>): Config {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
  }
  const variables = result.data;
  return { fleetUrl: variables.FLEET_URL.replace(/\/$/, ''), host: variables.HOST, port: variables.PORT, logLevel: variables.LOG_LEVEL };
}
