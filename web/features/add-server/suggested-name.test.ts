import { describe, expect, it } from 'vitest';

import { suggestedName } from './suggested-name';

describe("the proxy ship's name offered for a server's address", () => {
  it("is its host's first name that says whose it is", () => {
    expect(suggestedName('https://mcp.Linear.app/mcp')).toBe('linear');
  });

  it('is nothing for an address that is no URL', () => {
    expect(suggestedName('not a url')).toBe('');
  });
});
