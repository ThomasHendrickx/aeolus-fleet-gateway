import { describe, expect, it } from 'vitest';

import { addButtonLabel, suggestedName } from './suggested-name';

describe("the proxy ship's name offered for a server's address", () => {
  it("is its host's first name that says whose it is", () => {
    expect(suggestedName('https://mcp.Linear.app/mcp')).toBe('linear');
  });

  it('is nothing for an IPv4 address, whose numbers say nothing of whose it is', () => {
    expect(suggestedName('http://10.0.0.12:8000/mcp')).toBe('');
  });

  it('is nothing for an IPv6 address', () => {
    expect(suggestedName('http://[fd00::12]:8000/mcp')).toBe('');
  });

  it('is nothing for an address that is no URL', () => {
    expect(suggestedName('not a url')).toBe('');
  });
});

describe("the add button's words, following the proxy ship's name as typed", () => {
  it('names the proxy ship', () => {
    expect(addButtonLabel('basic-memory')).toBe('Add basic-memory');
  });

  it('names a name of 20 characters whole', () => {
    expect(addButtonLabel('a'.repeat(20))).toBe(`Add ${'a'.repeat(20)}`);
  });

  it('cuts a name over 20 characters at 20', () => {
    expect(addButtonLabel('company-vault-on-the-private-network')).toBe('Add company-vault-on-the…');
  });

  it('reads Add as outside party while no name is typed', () => {
    expect(addButtonLabel('  ')).toBe('Add as outside party');
  });
});
