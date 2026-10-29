import { describe, expect, it } from 'vitest';

import { changedScopesOf } from './scope-change';

const SELECTED = [
  { name: 'search_leads', scopes: ['crm:read-leads'] },
  { name: 'delete_lead', scopes: ['crm:write-leads', 'crm:admin'] },
  { name: 'ping', scopes: [] },
];

describe('a bulk change of the scopes the selected tools need (gateway scopes 4.3)', () => {
  it('adds the picked scopes to each, keeping what each needs already, each scope once', () => {
    expect(changedScopesOf(SELECTED, { scopes: ['crm:admin'], how: 'add' })).toEqual([
      { tool: 'search_leads', scopes: ['crm:read-leads', 'crm:admin'] },
      { tool: 'delete_lead', scopes: ['crm:write-leads', 'crm:admin'] },
      { tool: 'ping', scopes: ['crm:admin'] },
    ]);
  });

  it('removes the picked scopes from each, a tool left with none needing nothing of its own', () => {
    expect(changedScopesOf(SELECTED, { scopes: ['crm:read-leads', 'crm:admin'], how: 'remove' })).toEqual([
      { tool: 'search_leads', scopes: [] },
      { tool: 'delete_lead', scopes: ['crm:write-leads'] },
      { tool: 'ping', scopes: [] },
    ]);
  });

  it('replaces what each needs with the picked scopes', () => {
    expect(changedScopesOf(SELECTED, { scopes: ['crm:read-leads'], how: 'replace' })).toEqual([
      { tool: 'search_leads', scopes: ['crm:read-leads'] },
      { tool: 'delete_lead', scopes: ['crm:read-leads'] },
      { tool: 'ping', scopes: ['crm:read-leads'] },
    ]);
  });
});
