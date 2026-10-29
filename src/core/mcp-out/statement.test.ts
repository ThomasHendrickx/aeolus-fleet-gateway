import { describe, expect, it } from 'vitest';

import { NO_SCOPE_REQUIREMENTS } from '../parties/scope-requirements.js';
import type { OutsideTool } from './ports.js';
import { statementOf } from './statement.js';

const CREATE_DEAL: OutsideTool = {
  name: 'create_deal',
  title: 'Create a deal',
  description: 'Opens a deal for a contact; each call opens one.',
  inputSchema: { type: 'object', properties: { contactId: { type: 'string' } } },
  annotations: { readOnlyHint: false, idempotentHint: false },
};

const LIST_DEALS: OutsideTool = { name: 'list_deals', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };

/** The gateway's own timing: how long it waits for an answer, and when it gives up on the server. */
const TIMING = { waitMs: 10_000, deadlineMs: 300_000 };

describe("a proxy ship's statement, written from its server's tools/list (interop 3.2)", () => {
  it('states each tool as a capability with its MCP fields, its input type and its result type', () => {
    expect(statementOf({ partyName: 'crm', tools: [CREATE_DEAL], repeatable: new Set(), timing: TIMING, requirements: NO_SCOPE_REQUIREMENTS }).capabilities).toEqual([
      {
        name: 'create_deal',
        title: 'Create a deal',
        description: 'Opens a deal for a contact; each call opens one.',
        inputSchema: { type: 'object', properties: { contactId: { type: 'string' } } },
        inputModes: ['application/vnd.aeolus.mcp-tool+json; name=create_deal'],
        outputModes: ['application/vnd.aeolus.mcp-result+json; name=create_deal'],
        annotations: { readOnlyHint: false, idempotentHint: false },
        waitMs: 10_000,
        deadlineMs: 300_000,
      },
    ]);
  });

  it("states on each capability how long a caller waits for its answer and when the call fails, from the gateway's own timing (interop 3.4, 5.3)", () => {
    const capabilities = statementOf({ partyName: 'crm', tools: [CREATE_DEAL, LIST_DEALS], repeatable: new Set(), timing: { waitMs: 2_000, deadlineMs: 60_000 }, requirements: NO_SCOPE_REQUIREMENTS }).capabilities;

    expect(capabilities.map(({ name, waitMs, deadlineMs }) => ({ name, waitMs, deadlineMs }))).toEqual([
      { name: 'create_deal', waitMs: 2_000, deadlineMs: 60_000 },
      { name: 'list_deals', waitMs: 2_000, deadlineMs: 60_000 },
    ]);
  });

  it("states argo's repeatable mark, and only argo's: the server's hints are no trust (5.2)", () => {
    const capabilities = statementOf({ partyName: 'crm', tools: [CREATE_DEAL, LIST_DEALS], repeatable: new Set(['create_deal']), timing: TIMING, requirements: NO_SCOPE_REQUIREMENTS }).capabilities;

    expect(capabilities.map((capability) => [capability.name, capability.repeatable])).toEqual([
      ['create_deal', true],
      ['list_deals', undefined],
    ]);
  });

  it('states on each capability the scopes a calling ship needs, the party\'s and the tool\'s own, so a ship sees them before it calls (P1)', () => {
    const requirements = { version: 2, party: ['crm:use'], tools: new Map([['create_deal', ['crm:write-leads']]]) };

    const capabilities = statementOf({ partyName: 'crm', tools: [CREATE_DEAL, LIST_DEALS], repeatable: new Set(), timing: TIMING, requirements }).capabilities;

    expect(capabilities.map(({ name, scopes }) => ({ name, scopes }))).toEqual([
      { name: 'create_deal', scopes: ['crm:use', 'crm:write-leads'] },
      { name: 'list_deals', scopes: ['crm:use'] },
    ]);
  });

  it('states no scopes on a capability that needs none', () => {
    expect(statementOf({ partyName: 'crm', tools: [LIST_DEALS], repeatable: new Set(), timing: TIMING, requirements: NO_SCOPE_REQUIREMENTS }).capabilities[0]).not.toHaveProperty('scopes');
  });

  it('keeps an output schema the tool states', () => {
    expect(statementOf({ partyName: 'crm', tools: [LIST_DEALS], repeatable: new Set(), timing: TIMING, requirements: NO_SCOPE_REQUIREMENTS }).capabilities[0]?.outputSchema).toEqual({ type: 'object' });
  });

  it('says what the ship is without the outside URL or credential (NAT both ways)', () => {
    expect(statementOf({ partyName: 'crm', tools: [], repeatable: new Set(), timing: TIMING, requirements: NO_SCOPE_REQUIREMENTS }).summary).toBe(
      'crm, an outside MCP server reached through the Aeolus gateway. Each capability is one of its tools: send its input type with the tool arguments as a JSON object, and the reply carries the tool result.',
    );
  });
});
