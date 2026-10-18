import type { ShipId } from '@aeolus-fleet/common';

/** Calls one of the gateway's mutations, as the console's server or the gateway's page does: with argo's cookie, or the installation token. */
export function mutate(address: string, request: { procedure: string; cookie?: string; installationToken?: string; body: unknown }): Promise<Response> {
  return fetch(`${address}/trpc/${request.procedure}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(request.cookie === undefined ? {} : { cookie: request.cookie }),
      ...(request.installationToken === undefined ? {} : { 'x-aeolus-installation-token': request.installationToken }),
    },
    body: JSON.stringify(request.body),
  });
}

/** Calls one of the gateway's queries. */
export function query(address: string, request: { procedure: string; cookie?: string; installationToken?: string; input?: unknown }): Promise<Response> {
  const search = request.input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(request.input))}`;
  return fetch(`${address}/trpc/${request.procedure}${search}`, {
    headers: {
      ...(request.cookie === undefined ? {} : { cookie: request.cookie }),
      ...(request.installationToken === undefined ? {} : { 'x-aeolus-installation-token': request.installationToken }),
    },
  });
}

/** Connects the gateway with its ship's secret, as the console's server does. */
export function connectGateway(address: string, request: { cookie: string; shipId: ShipId; secret: string }): Promise<Response> {
  return mutate(address, { procedure: 'connection.connect', cookie: request.cookie, body: { shipId: request.shipId, secret: request.secret } });
}
