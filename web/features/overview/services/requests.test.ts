import { describe, expect, it } from 'vitest';

import { requestStatus, subjectName, suggestedName, type ShownRequest } from './requests';

const NOW = new Date('2026-10-21T09:00:00.000Z');

function aRequest(overrides: Partial<ShownRequest> = {}): ShownRequest {
  return {
    fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv',
    requestId: 'req_01m5c7hmbt9f1vrkwb37az0001',
    subject: { kind: 'server', url: 'https://crm.example.com/mcp' },
    requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
    askedAt: '2026-10-20T09:00:00.000Z',
    expiresAt: '2026-10-27T09:00:00.000Z',
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

describe('a request as the Overview states it', () => {
  it('names a server by its host and a client by its name', () => {
    expect([subjectName(aRequest()), subjectName(aRequest({ subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' } }))]).toEqual(['crm.example.com', 'Orderbot']);
  });

  it('counts the days left of a pending one up, 6 days and a minute reading 7', () => {
    expect(requestStatus(aRequest({ expiresAt: '2026-10-27T09:01:00.000Z' }), NOW)).toEqual({ tone: 'waiting', label: '7 d left' });
  });

  it('says a pending one has its last day once a day or less is left, in the attention tone', () => {
    expect([requestStatus(aRequest({ expiresAt: '2026-10-22T09:00:00.000Z' }), NOW), requestStatus(aRequest({ expiresAt: '2026-10-22T09:01:00.000Z' }), NOW)]).toEqual([
      { tone: 'attention', label: 'Last day' },
      { tone: 'waiting', label: '2 d left' },
    ]);
  });

  it('states a decided one by its state', () => {
    expect((['approving', 'approved', 'denied', 'expired'] as const).map((state) => requestStatus(aRequest({ state }), NOW).label)).toEqual(['Approving', 'Approved', 'Denied', 'Expired']);
  });

  it("offers a proxy ship's name from the party's own: lower case letters, digits and dashes", () => {
    expect(suggestedName('Acme CRM (prod)')).toBe('acme-crm-prod');
  });
});
