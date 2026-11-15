import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { A2aAgentForm } from './a2a-agent-form';

describe('adding an A2A agent', () => {
  it('offers each scope with the description read from the fleet', () => {
    const markup = renderToStaticMarkup(createElement(A2aAgentForm, {
      fleetId: 'fleet',
      requestId: 'request',
      owners: { isOk: true, value: [] },
      scopes: ['crm:read-leads'],
      listed: [{ scope: 'crm:read-leads', description: 'Read leads in the CRM' }],
    }));

    expect(markup).toContain('Read leads in the CRM');
    expect(markup).toContain('crm:read-leads');
  });
});
