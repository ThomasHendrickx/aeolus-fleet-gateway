import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from '@fastify/websocket';

import { err, ok } from '../../core/shared/result.js';
import type { Context } from '../trpc/router.js';
import { createChangeHub, registerLive, type ChangeHub } from './live.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const SIGNED_IN = 'aeolus_session=argo';
const HOST = 'gateway.example.com';
const ORIGIN = `http://${HOST}`;
const SILENCE_MS = 100;

let server: FastifyInstance;
let hub: ChangeHub;
let toDecide: number;
let sockets: WebSocket[];

function contextFor(cookie: string | undefined): Context {
  const unused = () => Promise.reject(new Error('not used by the live channel'));
  return {
    cookie,
    crewToken: undefined,
    authenticateActor: ({ cookie: sent }) =>
      Promise.resolve(sent === SIGNED_IN ? ok({ fleetId: FLEET, kind: 'operator' as const, scopes: ['gateway:approve'] }) : err({ kind: 'NOT_AN_ACTOR' as const, message: 'Sign in' })),
    isServed: unused,
    heldConnection: unused,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    setFleetEnabled: unused,
    readFleet: unused,
    deleteFleet: unused,
    readConnection: unused,
    connect: unused,
    approveParty: unused,
    crewParty: unused,
    listParties: unused,
    retireParty: unused,
    changePartyOwner: unused,
    changePartyScopes: unused,
    readParty: unused,
    checkServer: unused,
    readPartyTools: unused,
    stateParty: unused,
    markTool: unused,
    registerClient: unused,
    readOutsideParties: unused,
    setOutsideParties: unused,
    listToDecide: unused,
    listMine: unused,
    decideRequest: unused,
    endSignIns: unused,
  };
}

beforeEach(async () => {
  toDecide = 2;
  sockets = [];
  hub = createChangeHub();
  server = Fastify({ logger: false });
  registerLive(server, {
    contextFor,
    hub,
    pages: {
      overview: { render: (context, params) => Promise.resolve({ count: `${String(toDecide)} for ${context.cookie ?? ''}${params.has('requestId') ? ` on ${params.get('requestId') ?? ''}` : ''}` }) },
    },
  });
  await server.ready();
});

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  await server.close();
});

/** Opens the live channel as a page would, and collects what it is sent and how it closed. */
async function open(query: string, headers: Record<string, string> = { cookie: SIGNED_IN, origin: ORIGIN }) {
  const received: unknown[] = [];
  const closed: { code?: number } = {};
  // Heard from before the socket opens, as the first sections may come at once.
  const socket = await server.injectWS(
    `/live?${query}`,
    { headers: { host: HOST, ...headers } },
    {
      onInit: (opening) => {
        opening.on('message', (data: Buffer) => received.push(JSON.parse(data.toString())));
        opening.on('close', (code: number) => {
          closed.code = code;
        });
      },
    },
  );
  sockets.push(socket);
  return { socket, received, closed };
}

async function until(isDone: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!isDone()) {
    if (Date.now() > deadline) {
      throw new Error('not in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("the pages' live channel", () => {
  it('sends a page its sections as soon as it opens, read as its caller', async () => {
    const live = await open('page=overview&requestId=req_1');

    await until(() => live.received.length === 1);
    expect(live.received).toEqual([{ sections: { count: `2 for ${SIGNED_IN} on req_1` } }]);
  });

  it("sends a page its sections again when its fleet's requests change", async () => {
    const live = await open('page=overview');
    await until(() => live.received.length === 1);

    toDecide = 1;
    hub.publish({ fleetId: FLEET, topic: 'requests' });

    await until(() => live.received.length === 2);
    expect(live.received[1]).toEqual({ sections: { count: `1 for ${SIGNED_IN}` } });
  });

  it("sends nothing when another fleet's requests change", async () => {
    const live = await open('page=overview');
    await until(() => live.received.length === 1);

    hub.publish({ fleetId: OTHER_FLEET, topic: 'requests' });

    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
    expect(live.received).toHaveLength(1);
  });

  it('reads every page anew when the gateway may have missed changes', async () => {
    const live = await open('page=overview');
    await until(() => live.received.length === 1);

    hub.resync();

    await until(() => live.received.length === 2);
  });

  it('closes a socket with no session', async () => {
    const live = await open('page=overview', { origin: ORIGIN });

    await until(() => live.closed.code !== undefined);
    expect(live.closed.code).toBe(4401);
    expect(live.received).toEqual([]);
  });

  it('closes a socket opened from another origin', async () => {
    const live = await open('page=overview', { cookie: SIGNED_IN, origin: 'https://elsewhere.example.com' });

    await until(() => live.closed.code !== undefined);
    expect(live.closed.code).toBe(4403);
    expect(live.received).toEqual([]);
  });

  it('closes a socket for a page that is not live', async () => {
    const live = await open('page=nowhere');

    await until(() => live.closed.code !== undefined);
    expect(live.closed.code).toBe(4404);
  });

  it('stops reading a page once its socket closed', async () => {
    const live = await open('page=overview');
    await until(() => live.received.length === 1);
    live.socket.terminate();
    await until(() => hub.listeners() === 0);

    hub.publish({ fleetId: FLEET, topic: 'requests' });

    expect(hub.listeners()).toBe(0);
  });
});
