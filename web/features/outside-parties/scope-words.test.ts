import { describe, expect, it } from 'vitest';

import { scopeWords } from './scope-words';

describe("a party's scope in plain words", () => {
  it('says what a core scope allows, as the fleet words it', () => {
    expect(scopeWords('messages:send')).toBe('Send, answer and ask other ships');
  });

  it("keeps a plugin's scope by its name, as the fleet words only its own", () => {
    expect(scopeWords('squadrons:form')).toBe('squadrons:form');
  });
});
