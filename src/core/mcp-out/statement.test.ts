import { describe, expect, it } from 'vitest';

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

describe("a proxy ship's statement, written from its server's tools/list (interop 3.2)", () => {
  it('states each tool as a capability with its MCP fields, its input type and its result type', () => {
    expect(statementOf({ partyName: 'crm', tools: [CREATE_DEAL], repeatable: new Set() }).capabilities).toEqual([
      {
        name: 'create_deal',
        title: 'Create a deal',
        description: 'Opens a deal for a contact; each call opens one.',
        inputSchema: { type: 'object', properties: { contactId: { type: 'string' } } },
        inputModes: ['application/vnd.aeolus.mcp-tool+json; name=create_deal'],
        outputModes: ['application/vnd.aeolus.mcp-result+json; name=create_deal'],
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
    ]);
  });

  it("states argo's repeatable mark, and only argo's: the server's hints are no trust (5.2)", () => {
    const capabilities = statementOf({ partyName: 'crm', tools: [CREATE_DEAL, LIST_DEALS], repeatable: new Set(['create_deal']) }).capabilities;

    expect(capabilities.map((capability) => [capability.name, capability.repeatable])).toEqual([
      ['create_deal', true],
      ['list_deals', undefined],
    ]);
  });

  it('keeps an output schema the tool states', () => {
    expect(statementOf({ partyName: 'crm', tools: [LIST_DEALS], repeatable: new Set() }).capabilities[0]?.outputSchema).toEqual({ type: 'object' });
  });

  it('says what the ship is without the outside URL or credential (NAT both ways)', () => {
    expect(statementOf({ partyName: 'crm', tools: [], repeatable: new Set() }).summary).toBe(
      'crm, an outside MCP server reached through the Aeolus gateway. Each capability is one of its tools: send its input type with the tool arguments as a JSON object, and the reply carries the tool result.',
    );
  });
});
