import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TableTool } from '../table-tools';
import { NeedsChips } from './needs-chips';
import { ToolsSkeleton } from './tools-skeleton';
import { ToolsTable, type ToolsTableProps } from './tools-table';

/** The router a page's table sits under; a static render never navigates. */
const ROUTER: AppRouterInstance = { back: () => undefined, forward: () => undefined, refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined, bfcacheId: 'tools-table-test' };

const TOOLS: TableTool[] = [
  { name: 'search_leads', description: 'Search leads.', isReadOnly: true, isOn: true, isNew: false, scopes: ['crm:read-leads'] },
  { name: 'delete_lead', isReadOnly: false, isDestructive: true, isOn: false, isNew: false, scopes: ['crm:admin'] },
  { name: 'ping', isOn: true, isNew: true, scopes: [] },
];

const READER: ToolsTableProps = { fleetId: 'flt_1', party: 'crm', tools: TOOLS, version: 4, partyScopes: ['crm:use'], listed: null, canChange: false, serverRefusal: null };
const APPROVER: ToolsTableProps = { ...READER, listed: [{ scope: 'crm:use', description: 'Use the CRM' }, { scope: 'crm:read-leads', description: 'Read leads in the CRM' }], canChange: true };

function rendered(props: ToolsTableProps): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: ROUTER }, createElement(ToolsTable, props)));
}

function textOf(markup: string): string {
  return markup.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

const count = (markup: string, testId: string) => markup.split(`data-testid="${testId}"`).length - 1;

describe("an outside MCP server's tools table (gateway scopes 4.3)", () => {
  it('shows every tool as a row, with its hints where the server gives them, its switch state and what it needs', () => {
    const markup = rendered(READER);

    expect(count(markup, 'tools-table-row')).toBe(3);
    expect(textOf(markup)).toContain('search_leads Search leads. Read only On crm:use crm:read-leads');
    expect(textOf(markup)).toContain('delete_lead Destructive Off crm:use crm:admin');
  });

  it("shows the party's scopes muted beside each tool's own, and in the Every tool needs line", () => {
    const markup = rendered(READER);

    expect({ party: count(markup, 'tools-table-party-scope'), own: count(markup, 'tools-table-scope') }).toEqual({ party: 4, own: 2 });
    expect(textOf(markup)).toContain('Every tool needs crm:use');
  });

  it('shows anyone but an approver the same table read-only: no selection, switch, bulk action or Change', () => {
    const markup = rendered(READER);

    expect(['tools-table-select', 'tools-table-switch', 'tools-table-set-scopes', 'tools-table-switch-on', 'tools-table-suggest', 'tools-table-party-change'].map((testId) => count(markup, testId))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(count(markup, 'tools-table-name-filter')).toBeGreaterThan(0);
  });

  it('shows an approver a checkbox and a switch per row, Select all shown, the count selected, the bulk actions and Change', () => {
    const markup = rendered(APPROVER);

    expect({ select: count(markup, 'tools-table-select'), switches: count(markup, 'tools-table-switch'), change: count(markup, 'tools-table-party-change') }).toEqual({ select: 3, switches: 3, change: 1 });
    expect(textOf(markup)).toContain('Select all shown 0 selected Set scopes… Switch on Switch off Suggest from hints…');
  });

  it('offers the state filters All, On, Off, New and Needs nothing', () => {
    expect(textOf(rendered(READER))).toContain('All On Off New Needs nothing');
  });

  it('says the server did not answer, shows the kept requirements, keeps scopes editable and switching off', () => {
    const markup = rendered({ ...APPROVER, tools: [{ name: 'delete_lead', isOn: null, isNew: false, scopes: ['crm:admin'] }], serverRefusal: 'The MCP server of crm could not be listed: connect ECONNREFUSED' });

    expect(textOf(markup)).toContain('The server did not answer, so this shows the scopes kept per tool name; they can still be changed.');
    expect(textOf(markup)).toContain('delete_lead Not known');
    expect({ select: count(markup, 'tools-table-select'), switches: count(markup, 'tools-table-switch') }).toEqual({ select: 1, switches: 0 });
  });

  it('marks a required scope the fleet no longer lists', () => {
    expect(textOf(rendered(APPROVER))).toContain('crm:admin (no longer defined)');
  });

  it('says a server lists no tools', () => {
    expect(textOf(rendered({ ...READER, tools: [] }))).toContain('crm lists no tools.');
  });
});

describe('what a call needs, as chips', () => {
  it("shows a scope every tool needs once, muted, though the tool needs it too", () => {
    const markup = renderToStaticMarkup(createElement(NeedsChips, { party: ['crm:use'], own: ['crm:use', 'crm:admin'], listed: null }));

    expect({ party: count(markup, 'tools-table-party-scope'), own: count(markup, 'tools-table-scope') }).toEqual({ party: 1, own: 1 });
  });


  it('says Nothing when neither the party nor the tool needs a scope', () => {
    expect(textOf(renderToStaticMarkup(createElement(NeedsChips, { own: [], listed: null })))).toBe('Nothing');
  });
});

describe("the tools table while the server's tools/list is read", () => {
  it('shows skeleton rows, said busy', () => {
    const markup = renderToStaticMarkup(createElement(ToolsSkeleton, { party: 'crm' }));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Reading the tools crm lists"');
  });
});
