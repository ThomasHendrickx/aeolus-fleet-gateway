import { describe, expect, it } from 'vitest';

import { shownTools, tableToolsOf, type TableTool } from './table-tools';

const REQUIREMENTS = { version: 3, party: ['crm:use'], tools: [{ tool: 'update_lead', scopes: ['crm:write-leads'] }, { tool: 'archived_tool', scopes: ['crm:admin'] }] };

const aTool = (tool: Partial<TableTool> & { name: string }): TableTool => ({ isOn: true, isNew: false, scopes: [], ...tool });

describe('the rows of a server\'s tools table (gateway scopes 4.3)', () => {
  it('gives each tool the server lists its own required scopes, by name', () => {
    expect(
      tableToolsOf({
        read: { isOk: true, value: { tools: [{ name: 'search_leads', isReadOnly: true, isOn: true, isNew: false }, { name: 'update_lead', isOn: false, isNew: true }] } },
        requirements: REQUIREMENTS,
      }),
    ).toEqual([
      { name: 'search_leads', isReadOnly: true, isOn: true, isNew: false, scopes: [] },
      { name: 'update_lead', isOn: false, isNew: true, scopes: ['crm:write-leads'] },
    ]);
  });

  it('shows the requirements kept per tool name while the server does not answer, each switch unknown', () => {
    expect(tableToolsOf({ read: { isOk: false, refusal: 'The MCP server of crm could not be listed: connect ECONNREFUSED' }, requirements: REQUIREMENTS })).toEqual([
      { name: 'update_lead', isOn: null, isNew: false, scopes: ['crm:write-leads'] },
      { name: 'archived_tool', isOn: null, isNew: false, scopes: ['crm:admin'] },
    ]);
  });
});

describe('the tools shown by the filters (gateway scopes 4.3)', () => {
  const tools = [
    aTool({ name: 'search_leads', scopes: ['crm:read-leads'] }),
    aTool({ name: 'delete_lead', isOn: false }),
    aTool({ name: 'delete_note', isOn: false, isNew: true }),
    aTool({ name: 'ping' }),
  ];
  const namesOf = (shown: readonly TableTool[]) => shown.map(({ name }) => name);

  it('shows every tool for All and no name', () => {
    expect(namesOf(shownTools(tools, { name: '', state: 'all', partyScopes: [] }))).toEqual(['search_leads', 'delete_lead', 'delete_note', 'ping']);
  });

  it('shows the tools whose name holds the text, in any case', () => {
    expect(namesOf(shownTools(tools, { name: 'DELETE', state: 'all', partyScopes: [] }))).toEqual(['delete_lead', 'delete_note']);
  });

  it.each([
    { state: 'on' as const, names: ['search_leads', 'ping'] },
    { state: 'off' as const, names: ['delete_lead', 'delete_note'] },
    { state: 'new' as const, names: ['delete_note'] },
    { state: 'needsNothing' as const, names: ['delete_lead', 'delete_note', 'ping'] },
  ])('shows the tools that are $state', ({ state, names }) => {
    expect(namesOf(shownTools(tools, { name: '', state, partyScopes: [] }))).toEqual(names);
  });

  it('shows no tool as needing nothing while every tool needs the party\'s scopes', () => {
    expect(shownTools(tools, { name: '', state: 'needsNothing', partyScopes: ['crm:use'] })).toEqual([]);
  });

  it('combines the name and the state', () => {
    expect(namesOf(shownTools(tools, { name: 'delete', state: 'new', partyScopes: [] }))).toEqual(['delete_note']);
  });
});
