import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../config.js';
import { requireCoreVersion, type VersionFetch } from './core-version.js';

const FLEET_URL = 'https://fleet.example';

/** A core that answers `/api/version` with this body, recording each URL asked. */
function aCore(body: unknown, status = 200): VersionFetch & { asked: string[] } {
  const asked: string[] = [];
  const fetch = (url: string) => {
    asked.push(url);
    return Promise.resolve({ status, json: () => Promise.resolve(body) });
  };
  return Object.assign(fetch, { asked });
}

/** A core that answers `/api/version` with this server version. */
function aCoreAt(server: string): VersionFetch {
  return aCore({ server, common: server });
}

describe('the gateway starts only against a core it runs with (decision 0049)', () => {
  it('starts against a core at its minimum', async () => {
    await expect(requireCoreVersion(FLEET_URL, aCoreAt('0.32.0'))).resolves.toBeUndefined();
  });

  it('starts against a newer core, compared by number and not as text', async () => {
    await expect(requireCoreVersion(FLEET_URL, aCoreAt('0.100.0'))).resolves.toBeUndefined();
  });

  it('starts against core 0.0.0, a build from main', async () => {
    await expect(requireCoreVersion(FLEET_URL, aCoreAt('0.0.0'))).resolves.toBeUndefined();
  });

  it('refuses to start against core 0.31.0, the minor before its minimum, which pushes held hand-overs ahead of a new delivery, naming the gateway and both versions', async () => {
    await expect(requireCoreVersion(FLEET_URL, aCoreAt('0.31.0'))).rejects.toThrow(
      new ConfigError('gateway 0.0.0 needs core 0.32.0 or later; the fleet at https://fleet.example runs core 0.31.0: upgrade core first'),
    );
  });

  it('refuses to start against an older minor whose patch is higher', async () => {
    await expect(requireCoreVersion(FLEET_URL, aCoreAt('0.28.12'))).rejects.toThrow(
      new ConfigError('gateway 0.0.0 needs core 0.32.0 or later; the fleet at https://fleet.example runs core 0.28.12: upgrade core first'),
    );
  });

  it('asks the fleet at /api/version, keeping its path, whether or not it ends in a slash', async () => {
    const core = aCore({ server: '0.32.0', common: '0.32.0' });
    await requireCoreVersion('https://example.com/fleet/', core);
    expect(core.asked).toEqual(['https://example.com/fleet/api/version']);
  });

  it('refuses to start when the fleet does not answer, saying why', async () => {
    const down: VersionFetch = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4000'));
    await expect(requireCoreVersion(FLEET_URL, down)).rejects.toThrow(
      new ConfigError('gateway 0.0.0 needs core 0.32.0 or later, and could not read the version of the fleet at https://fleet.example: connect ECONNREFUSED 127.0.0.1:4000'),
    );
  });

  it('refuses to start when the fleet answers an HTTP error', async () => {
    await expect(requireCoreVersion(FLEET_URL, aCore({}, 503))).rejects.toThrow(
      new ConfigError('gateway 0.0.0 needs core 0.32.0 or later, and could not read the version of the fleet at https://fleet.example: HTTP 503'),
    );
  });

  it('refuses to start when the answer holds no MAJOR.MINOR.PATCH version', async () => {
    await expect(requireCoreVersion(FLEET_URL, aCoreAt('0.28'))).rejects.toThrow(
      new ConfigError('gateway 0.0.0 needs core 0.32.0 or later, and could not read the version of the fleet at https://fleet.example: its /api/version answered no core version'),
    );
  });
});
