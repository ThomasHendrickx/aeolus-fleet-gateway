import { createServer } from 'node:http';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { gatewayApi } from '../../../lib/gateway-api/gateway-api';
import { AddA2aClient } from '../../add-a2a-client/ui/add-a2a-client';
import { OutsideParty } from './outside-party';

/** A gateway API answering with descriptions that differ from the static core copy. */
async function withGateway(run: (url: string) => Promise<void>, refuseList = false) {
  const server = createServer((request, response) => {
    if (refuseList && request.url?.includes('parties.listedScopes')) {
      response.statusCode = 403;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: { message: 'List refused', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } } }));
      return;
    }
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
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error); }));
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
      expect(markup).toContain('Rename, release, recrew and retire the ships it manages');
      expect(markup).toContain('custom:unknown');
    });
  });
  it('shows static descriptions on the client form for a reader without approval', async () => {
    await withGateway(async (url) => {
      const page = { kind: 'signedIn' as const, api: gatewayApi({ url, cookie: undefined, fleetId: 'fleet' }), fleetId: 'fleet', scopes: ['fleet:read'] };
      const markup = renderToStaticMarkup(await AddA2aClient({ page }));
      expect(markup).toContain('Read ships, timelines, messages, labels, events and fleet-wide views');
      expect(markup).not.toContain('List refused');
    }, true);
  });

  it('shows static descriptions on the client form when the list is refused', async () => {
    await withGateway(async (url) => {
      const page = { kind: 'signedIn' as const, api: gatewayApi({ url, cookie: undefined, fleetId: 'fleet' }), fleetId: 'fleet', scopes: ['fleet:read', 'custom:unknown', 'gateway:approve'] };
      const markup = renderToStaticMarkup(await AddA2aClient({ page }));
      expect(markup).toContain('Read ships, timelines, messages, labels, events and fleet-wide views');
      expect(markup).toContain('custom:unknown');
      expect(markup).not.toContain('Description unavailable');
      expect(markup).not.toContain('List refused');
    }, true);
  });

  it('shows static descriptions on an outside party for a reader without approval', async () => {
    await withGateway(async (url) => {
      const page = { kind: 'signedIn' as const, api: gatewayApi({ url, cookie: undefined, fleetId: 'fleet' }), fleetId: 'fleet', scopes: ['fleet:read'] };
      const markup = renderToStaticMarkup(await OutsideParty({ page, name: 'client', outcome: null }));
      expect(markup).toContain('Read ships, timelines, messages, labels, events and fleet-wide views');
      expect(markup).toContain('custom:unknown');
    }, true);
  });

  it('shows static descriptions on an outside party when the list is refused', async () => {
    await withGateway(async (url) => {
      const page = { kind: 'signedIn' as const, api: gatewayApi({ url, cookie: undefined, fleetId: 'fleet' }), fleetId: 'fleet', scopes: ['gateway:approve'] };
      const markup = renderToStaticMarkup(await OutsideParty({ page, name: 'client', outcome: null }));
      expect(markup).toContain('Read ships, timelines, messages, labels, events and fleet-wide views');
    }, true);
  });

});
