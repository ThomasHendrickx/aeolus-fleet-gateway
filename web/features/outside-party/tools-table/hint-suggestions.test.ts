import { describe, expect, it } from 'vitest';

import { hintSuggestionsOf, suggestedScopesOf } from './hint-suggestions';

const TOOLS = [
  { name: 'search_leads', isReadOnly: true, scopes: [] },
  { name: 'read_lead', isReadOnly: true, isDestructive: false, scopes: [] },
  { name: 'update_lead', isReadOnly: false, scopes: [] },
  { name: 'delete_lead', isDestructive: true, scopes: [] },
  { name: 'export_leads', isReadOnly: true, scopes: ['crm:export'] },
  { name: 'ping', scopes: [] },
];

describe('suggestions from the hints a server gives (gateway scopes 4.3)', () => {
  it('suggests the read-only scopes for every tool with no scope of its own the server says reads only', () => {
    expect(hintSuggestionsOf(TOOLS).readOnly).toEqual(['search_leads', 'read_lead']);
  });

  it('suggests the other scopes where the server says a tool is not read-only or is destructive', () => {
    expect(hintSuggestionsOf(TOOLS).other).toEqual(['update_lead', 'delete_lead']);
  });

  it('lists the tools without hints apart, untouched', () => {
    expect(hintSuggestionsOf(TOOLS).withoutHints).toEqual(['ping']);
  });

  it('leaves out every tool that needs a scope of its own already', () => {
    expect(Object.values(hintSuggestionsOf(TOOLS)).flat()).not.toContain('export_leads');
  });

  it('changes only the tools of a group whose picker has scopes', () => {
    expect(suggestedScopesOf(hintSuggestionsOf(TOOLS), { readOnly: ['crm:read-leads'], other: [] })).toEqual([
      { tool: 'search_leads', scopes: ['crm:read-leads'] },
      { tool: 'read_lead', scopes: ['crm:read-leads'] },
    ]);
  });

  it('changes both groups, each with its own scopes', () => {
    expect(suggestedScopesOf(hintSuggestionsOf(TOOLS), { readOnly: ['crm:read-leads'], other: ['crm:write-leads'] })).toEqual([
      { tool: 'search_leads', scopes: ['crm:read-leads'] },
      { tool: 'read_lead', scopes: ['crm:read-leads'] },
      { tool: 'update_lead', scopes: ['crm:write-leads'] },
      { tool: 'delete_lead', scopes: ['crm:write-leads'] },
    ]);
  });
});
