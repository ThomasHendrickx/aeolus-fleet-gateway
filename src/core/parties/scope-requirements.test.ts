import { describe, expect, it } from 'vitest';

import { lackingScopesMessage, NO_SCOPE_REQUIREMENTS, scopesLacking, scopesNeeded, type ScopeRequirements } from './scope-requirements.js';

const CRM: ScopeRequirements = {
  version: 3,
  party: ['crm:use'],
  tools: new Map([
    ['update_lead', ['crm:write-leads']],
    ['delete_lead', ['crm:write-leads', 'crm:admin']],
    ['read_lead', ['crm:use']],
  ]),
};

describe('a tool needs the scopes set for its party and its own, all of them (gateway scopes A5)', () => {
  it('needs the party set and the tool set together', () => {
    expect(scopesNeeded(CRM, 'update_lead')).toEqual(['crm:use', 'crm:write-leads']);
  });

  it('names a scope both sets hold once', () => {
    expect(scopesNeeded(CRM, 'read_lead')).toEqual(['crm:use']);
  });

  it('needs only the party set for a tool with none of its own, as a tool the server adds later', () => {
    expect(scopesNeeded(CRM, 'search_leads')).toEqual(['crm:use']);
  });

  it('needs the party set for a party called as a whole, an A2A agent', () => {
    expect(scopesNeeded(CRM, null)).toEqual(['crm:use']);
  });

  it('needs nothing beyond reaching the party where nothing is set', () => {
    expect(scopesNeeded(NO_SCOPE_REQUIREMENTS, 'update_lead')).toEqual([]);
  });
});

describe('a calling ship lacks each needed scope it does not hold', () => {
  it('lacks nothing when it holds every one', () => {
    expect(scopesLacking(['crm:use', 'crm:write-leads'], ['messages:send', 'crm:write-leads', 'crm:use'])).toEqual([]);
  });

  it('lacks a scope held only in part: holding one of two is not enough', () => {
    expect(scopesLacking(['crm:write-leads', 'crm:admin'], ['crm:write-leads'])).toEqual(['crm:admin']);
  });
});

describe('a refusal names what is missing (gateway scopes P2)', () => {
  it('names the tool, the scope and the ship', () => {
    expect(lackingScopesMessage({ needing: 'update_lead', lacking: ['crm:write-leads'], shipName: 'lead-scout' })).toBe('update_lead needs crm:write-leads, which lead-scout does not hold');
  });

  it('names every scope lacking', () => {
    expect(lackingScopesMessage({ needing: 'delete_lead', lacking: ['crm:write-leads', 'crm:admin'], shipName: 'lead-scout' })).toBe(
      'delete_lead needs crm:write-leads and crm:admin, which lead-scout does not hold',
    );
  });
});
