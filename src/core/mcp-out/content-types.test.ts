import { describe, expect, it } from 'vitest';

import { isToolResultType, toolCalledBy, toolInputType, toolResultType } from './content-types.js';

describe('the content types that name an outside tool (orchestrator-1 on aeolus-fleet#876, Q7)', () => {
  it('names the tool to call in the input type', () => {
    expect(toolInputType('create_deal')).toBe('application/vnd.aeolus.mcp-tool+json; name=create_deal');
  });

  it("names the tool whose result a reply carries in the result type", () => {
    expect(toolResultType('create_deal')).toBe('application/vnd.aeolus.mcp-result+json; name=create_deal');
  });

  it('reads the tool a message calls from its content type', () => {
    expect(toolCalledBy('application/vnd.aeolus.mcp-tool+json; name=crm.list_contacts')).toBe('crm.list_contacts');
  });

  it('reads it whatever the case of the type and the spaces around the parameter', () => {
    expect(toolCalledBy('Application/VND.Aeolus.MCP-Tool+JSON;name=list_deals')).toBe('list_deals');
  });

  it('reads no tool from another type', () => {
    expect([toolCalledBy('application/json'), toolCalledBy('text/plain'), toolCalledBy('application/vnd.aeolus.mcp-result+json; name=x')]).toEqual([undefined, undefined, undefined]);
  });

  it('reads no tool from the input type without a name', () => {
    expect([toolCalledBy('application/vnd.aeolus.mcp-tool+json'), toolCalledBy('application/vnd.aeolus.mcp-tool+json; name=')]).toEqual([undefined, undefined]);
  });

  it('reads whether a reply carries a tool result, whatever its name, case and spaces', () => {
    expect([isToolResultType('application/vnd.aeolus.mcp-result+json; name=x'), isToolResultType('Application/VND.Aeolus.MCP-Result+JSON;name=x'), isToolResultType('application/json')]).toEqual([true, true, false]);
  });
});
