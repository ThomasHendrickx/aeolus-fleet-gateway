import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeSecrets, memoryOAuthClients } from '../../../test/support/oauth-fakes.js';
import { createRegisterClient } from './register-client.js';

function registering() {
  const clients = memoryOAuthClients();
  return { clients, registerClient: createRegisterClient({ clients, secrets: fakeSecrets() }) };
}

describe('argo pre-registers an MCP client (no dynamic registration, MCP 2026-07-28)', () => {
  it('registers a confidential client: its id, and its secret once, kept only as a hash', async () => {
    const { clients, registerClient } = registering();

    await expect(registerClient({ fleetId: FLEET_ID, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], isConfidential: true })).resolves.toEqual({
      isOk: true,
      value: { clientId: 'client-secret-1', clientSecret: 'secret-2' },
    });
    expect(clients.held.get('client-secret-1')).toEqual({ clientId: 'client-secret-1', fleetId: FLEET_ID, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: 'hash(secret-2)', grant: 'authorizationCode' });
  });

  it('registers a public client with no secret', async () => {
    const { registerClient } = registering();

    await expect(registerClient({ fleetId: FLEET_ID, name: 'Desktop', redirectUris: ['http://127.0.0.1:33418/callback'], isConfidential: false })).resolves.toMatchObject({
      isOk: true,
      value: { clientSecret: null },
    });
  });

  it.each([
    ['no redirect URI', []],
    ['a redirect URI over plain http to another host', ['http://cursor.example.com/callback']],
    ['a redirect URI with a fragment', ['https://cursor.example.com/callback#x']],
    ['a redirect URI that is no URL', ['callback']],
    ['eleven redirect URIs', Array.from({ length: 11 }, (_, index) => `https://cursor.example.com/${String(index)}`)],
  ])('refuses %s, registering nothing', async (_what, redirectUris) => {
    const { clients, registerClient } = registering();

    await expect(registerClient({ fleetId: FLEET_ID, name: 'Cursor', redirectUris, isConfidential: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_REDIRECT_URIS' } });
    expect(clients.held.size).toBe(0);
  });

  it('takes ten redirect URIs, loopback http among them', async () => {
    const { registerClient } = registering();
    const redirectUris = ['http://localhost:8080/cb', 'http://[::1]/cb', ...Array.from({ length: 8 }, (_, index) => `https://cursor.example.com/${String(index)}`)];

    await expect(registerClient({ fleetId: FLEET_ID, name: 'Cursor', redirectUris, isConfidential: true })).resolves.toMatchObject({ isOk: true });
  });
});
