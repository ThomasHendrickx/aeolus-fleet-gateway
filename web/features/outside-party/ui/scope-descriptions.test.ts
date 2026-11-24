import { createServer } from 'node:http';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { gatewayApi } from '../../../lib/gateway-api/gateway-api';
import { AddA2aClient } from '../../add-a2a-client/ui/add-a2a-client';
import { OutsideParty } from './outside-party';

/** A gateway API answering with descriptions that differ from the static core copy. */
async function withGateway(run: (url: string) => Promise<void>) {
  const server = createServer((request, response) => {
    const data = request.url?.includes('parties.get')
      ? { kind: 'mcpClient', name: 'client', state: 'crewed', clientId: 'client-id', proxyShipName: 'client', ownerName: 'argo', scopes: ['fleet:read', 'fleet:manage', 'custom:unknown'] }
      : request.url?.includes('parties.ownerChoices')
        ? []
        : { scopes: [{ scope: 'fleet:read', description: 'Fleet supplied description' }] };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ result: { data } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No test server address');
  try {
    await run(`http://127.0.0.1:${String(address.port)}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

describe('fleet scope descriptions', () => {
  it('shows the fleet description beside a scope on the Add A2A client form', async () => {
    await withGateway(async (url) => {
      const page = { kind: 'signedIn' as const, api: gatewayApi({ url, cookie: undefined, fleetId: 'fleet' }), fleetId: 'fleet', scopes: ['fleet:read', 'gateway:approve'] };
      const markup = renderToStaticMarkup(await AddA2aClient({ page }));
      expect(markup).toContain('Fleet supplied description');
      expect(markup).toContain('name="scope:fleet:read"');
    });
  });

  it('shows the fleet description on an outside party and falls back to an unlisted scope code', async () => {
    await withGateway(async (url) => {
      const page = { kind: 'signedIn' as const, api: gatewayApi({ url, cookie: undefined, fleetId: 'fleet' }), fleetId: 'fleet', scopes: ['gateway:approve'] };
      const markup = renderToStaticMarkup(await OutsideParty({ page, name: 'client', outcome: null }));
      expect(markup).toContain('Fleet supplied description');
      expect(markup).toContain('fleet:manage');
      expect(markup).toContain('custom:unknown');
    });
  });
});
