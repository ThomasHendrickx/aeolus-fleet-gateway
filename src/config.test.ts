import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, loadDatabaseUrl } from './config.js';

const DATABASE_URL = 'postgresql://gateway:secret@db.example:5432/gateway';
const GATEWAY_SECRET = 'a-gateway-secret-of-at-least-32-characters';

describe('the gateway configuration from the environment', () => {
  it('reads the fleet URL without its trailing slash, and defaults the rest', () => {
    expect(loadConfig({ DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'http://localhost:4000/' })).toEqual({
      databaseUrl: DATABASE_URL,
      fleetUrl: 'http://localhost:4000',
      host: '127.0.0.1',
      port: 4200,
      logLevel: 'info',
      installationToken: undefined,
      publicUrl: 'http://127.0.0.1:4200',
      gatewaySecret: GATEWAY_SECRET,
      mcpWaitMaxMs: 10_000,
    });
  });

  it('reads the host, port and log level', () => {
    expect(loadConfig({ DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'https://fleet.example', HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'debug' })).toEqual({
      databaseUrl: DATABASE_URL,
      fleetUrl: 'https://fleet.example',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'debug',
      installationToken: undefined,
      publicUrl: 'http://127.0.0.1:8080',
      gatewaySecret: GATEWAY_SECRET,
      mcpWaitMaxMs: 10_000,
    });
  });

  it('reads where outside MCP clients reach the gateway without its trailing slash: the OAuth issuer, and its MCP endpoint below it', () => {
    expect(loadConfig({ DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'https://fleet.example', GATEWAY_PUBLIC_URL: 'https://gateway.example/' }).publicUrl).toBe('https://gateway.example');
  });

  it('refuses a missing gateway secret, and one of 31 characters: it keys aliases, handles and idempotency keys', () => {
    expect(() => loadConfig({ DATABASE_URL, FLEET_URL: 'https://fleet.example' })).toThrow(/^GATEWAY_SECRET: /);
    expect(() => loadConfig({ DATABASE_URL, FLEET_URL: 'https://fleet.example', GATEWAY_SECRET: 'x'.repeat(31) })).toThrow('GATEWAY_SECRET: must hold at least 32 characters');
  });

  it("reads how long an MCP client's call waits for its answer, and refuses a wait below 0", () => {
    const environment = { DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'https://fleet.example' };
    expect([loadConfig({ ...environment, MCP_WAIT_MAX_MS: '0' }).mcpWaitMaxMs, loadConfig({ ...environment, MCP_WAIT_MAX_MS: '30000' }).mcpWaitMaxMs]).toEqual([0, 30_000]);
    expect(() => loadConfig({ ...environment, MCP_WAIT_MAX_MS: '-1' })).toThrow(/^MCP_WAIT_MAX_MS: /);
  });

  it('refuses a public URL that is not http or https, naming the variable', () => {
    expect(() => loadConfig({ DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'https://fleet.example', GATEWAY_PUBLIC_URL: 'ftp://gateway.example' })).toThrow(/^GATEWAY_PUBLIC_URL: /);
  });

  it('refuses a missing fleet URL, naming the variable', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/^FLEET_URL: /);
  });

  it('reads an installation token of 32 characters, and refuses one of 31', () => {
    const environment = { DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'https://fleet.example' };
    expect(loadConfig({ ...environment, INSTALLATION_TOKEN: 'x'.repeat(32) }).installationToken).toBe('x'.repeat(32));
    expect(() => loadConfig({ ...environment, INSTALLATION_TOKEN: 'x'.repeat(31) })).toThrow('INSTALLATION_TOKEN: must hold at least 32 characters');
  });

  it('refuses a missing database URL, naming the variable', () => {
    expect(() => loadConfig({ FLEET_URL: 'https://fleet.example' })).toThrow(/^DATABASE_URL: /);
  });

  it('refuses a database URL that is not postgres', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://db.example/gateway', FLEET_URL: 'https://fleet.example' })).toThrow(
      'DATABASE_URL: must be a postgres:// or postgresql:// URL',
    );
  });

  it('reads the database URL alone for migrate', () => {
    expect(loadDatabaseUrl({ DATABASE_URL })).toBe(DATABASE_URL);
  });

  it('refuses a fleet URL that is not http or https', () => {
    expect(() => loadConfig({ DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'ftp://fleet.example' })).toThrow('FLEET_URL: must be an http:// or https:// URL');
  });

  it('refuses a port above 65535', () => {
    expect(() => loadConfig({ DATABASE_URL, GATEWAY_SECRET, FLEET_URL: 'https://fleet.example', PORT: '65536' })).toThrow(/^PORT: /);
  });
});
