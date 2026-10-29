import { describe, expect, it } from 'vitest';

import { tickedScopes } from './ticked-scopes';

describe("the scopes an approver ticks for an A2A client's proxy ship", () => {
  it('answers each ticked scope, by its field', () => {
    expect(tickedScopes({ 'scope:fleet:read': 'on', 'scope:labels:define': 'on', name: 'supplier' })).toEqual(['fleet:read', 'labels:define']);
  });

  it('answers none when none is ticked', () => {
    expect(tickedScopes({ name: 'supplier' })).toEqual([]);
  });
});
