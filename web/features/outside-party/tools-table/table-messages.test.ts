import { describe, expect, it } from 'vitest';

import { partyScopesSetMessage, scopesSetMessage, statedMessage, suggestionsSetMessage, toolsSwitchedMessage } from './table-messages';

describe('what the tools table says once a change is kept (gateway scopes 4.3)', () => {
  it('says a scope set on the selected tools, as the design words it', () => {
    expect(scopesSetMessage({ scopes: ['crm:read-leads'], how: 'add', count: 12 })).toBe('crm:read-leads set on 12 tools');
  });

  it('names several scopes, and one tool as one', () => {
    expect(scopesSetMessage({ scopes: ['crm:read-leads', 'crm:write-leads', 'crm:admin'], how: 'replace', count: 1 })).toBe('crm:read-leads, crm:write-leads and crm:admin set on 1 tool');
  });

  it('says scopes removed from the selected tools', () => {
    expect(scopesSetMessage({ scopes: ['crm:admin'], how: 'remove', count: 3 })).toBe('crm:admin removed from 3 tools');
  });

  it('says the selected tools need nothing of their own once replaced with none', () => {
    expect(scopesSetMessage({ scopes: [], how: 'replace', count: 3 })).toBe('3 tools need nothing of their own');
  });

  it('says what every tool needs now', () => {
    expect(partyScopesSetMessage({ party: 'crm', scopes: ['crm:use'] })).toBe('Every tool of crm needs crm:use');
  });

  it('says every tool needs nothing once the party\'s scopes are cleared', () => {
    expect(partyScopesSetMessage({ party: 'crm', scopes: [] })).toBe('Every tool of crm needs nothing beyond reaching it');
  });

  it('says the suggestions applied, per group', () => {
    expect(suggestionsSetMessage([{ scopes: ['crm:read-leads'], count: 31 }, { scopes: ['crm:write-leads'], count: 14 }])).toBe('crm:read-leads set on 31 tools; crm:write-leads set on 14 tools');
  });

  it('says the selected tools switched', () => {
    expect(toolsSwitchedMessage({ count: 12, isOn: false, statementRefusal: null })).toBe('12 tools switched off');
  });

  it("says why the fleet sees the switch only at the proxy ship's next statement", () => {
    expect(toolsSwitchedMessage({ count: 1, isOn: true, statementRefusal: 'The fleet did not answer' })).toBe("1 tool switched on; the fleet sees it at the proxy ship's next statement: The fleet did not answer");
  });

  it("says why the fleet sees a change of scopes only at the proxy ship's next statement", () => {
    expect(statedMessage('crm:admin removed from 3 tools', 'The fleet did not answer')).toBe("crm:admin removed from 3 tools; the fleet sees it at the proxy ship's next statement: The fleet did not answer");
  });
});
