import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

describe('the gateway configuration from the environment', () => {
  it('reads the fleet URL without its trailing slash, and defaults the rest', () => {
    expect(loadConfig({ FLEET_URL: 'http://localhost:4000/' })).toEqual({
      fleetUrl: 'http://localhost:4000',
      host: '127.0.0.1',
      port: 4200,
      logLevel: 'info',
    });
  });

  it('reads the host, port and log level', () => {
    expect(loadConfig({ FLEET_URL: 'https://fleet.example', HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'debug' })).toEqual({
      fleetUrl: 'https://fleet.example',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'debug',
    });
  });

  it('refuses a missing fleet URL, naming the variable', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/^FLEET_URL: /);
  });

  it('refuses a fleet URL that is not http or https', () => {
    expect(() => loadConfig({ FLEET_URL: 'ftp://fleet.example' })).toThrow('FLEET_URL: must be an http:// or https:// URL');
  });

  it('refuses a port above 65535', () => {
    expect(() => loadConfig({ FLEET_URL: 'https://fleet.example', PORT: '65536' })).toThrow(/^PORT: /);
  });
});
