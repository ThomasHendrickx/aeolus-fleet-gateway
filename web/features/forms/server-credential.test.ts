import { describe, expect, it } from 'vitest';

import { serverCredentialOf } from './server-credential';

const TYPED = { token: 'crm-token', clientId: 'gw', clientSecret: 's3cret', issuer: 'https://auth.example.com', scope: '' };

describe("an outside MCP server's credential, as a form sends it", () => {
  it('is none for a server that asks for no credential, whatever else was typed (aeolus-fleet#1153)', () => {
    expect(serverCredentialOf({ ...TYPED, credentialKind: 'none' })).toEqual({ kind: 'none' });
  });

  it('is the bearer token typed', () => {
    expect(serverCredentialOf({ ...TYPED, credentialKind: 'bearer' })).toEqual({ kind: 'bearer', token: 'crm-token' });
  });

  it('is the client credentials typed, with no scope when none was typed', () => {
    expect(serverCredentialOf({ ...TYPED, credentialKind: 'clientCredentials' })).toEqual({ kind: 'clientCredentials', clientId: 'gw', clientSecret: 's3cret', issuer: 'https://auth.example.com' });
  });

  it('is the client credentials typed, with the scope typed', () => {
    expect(serverCredentialOf({ ...TYPED, credentialKind: 'clientCredentials', scope: 'mcp' })).toEqual({ kind: 'clientCredentials', clientId: 'gw', clientSecret: 's3cret', issuer: 'https://auth.example.com', scope: 'mcp' });
  });
});
