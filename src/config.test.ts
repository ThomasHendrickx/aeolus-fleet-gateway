import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, loadDatabaseUrl } from './config.js';

const DATABASE_URL = 'postgresql://gateway:secret@db.example:5432/gateway';

describe('the gateway configuration from the environment', () => {
  it('reads the fleet URL without its trailing slash, and defaults the rest', () => {
    expect(loadConfig({ DATABASE_URL, FLEET_URL: 'http://localhost:4000/' })).toEqual({
      databaseUrl: DATABASE_URL,
      fleetUrl: 'http://localhost:4000',
      host: '127.0.0.1',
      port: 4200,
      logLevel: 'info',
    });
  });

  it('reads the host, port and log level', () => {
    expect(loadConfig({ DATABASE_URL, FLEET_URL: 'https://fleet.example', HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'debug' })).toEqual({
      databaseUrl: DATABASE_URL,
      fleetUrl: 'https://fleet.example',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'debug',
    });
  });

  it('refuses a missing fleet URL, naming the variable', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/^FLEET_URL: /);
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
    expect(() => loadConfig({ DATABASE_URL, FLEET_URL: 'ftp://fleet.example' })).toThrow('FLEET_URL: must be an http:// or https:// URL');
  });

  it('refuses a port above 65535', () => {
    expect(() => loadConfig({ DATABASE_URL, FLEET_URL: 'https://fleet.example', PORT: '65536' })).toThrow(/^PORT: /);
  });
});
