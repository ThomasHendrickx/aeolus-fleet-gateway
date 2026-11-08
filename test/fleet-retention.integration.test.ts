import { idSchema, SCOPES, type FleetId } from '@aeolus-fleet/common';
import { createApp, createPrismaClient, createUseCases, newKey, secretOf, unwrap, type PrismaClient, type ShipCaller } from '@aeolus-fleet/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createFleetRetention } from '../src/adapters/fleet/fleet-retention.js';
import { startAccountIssuer, type AccountIssuer } from './support/account-issuer.js';
import { aMigratedDatabase } from './support/fleet-server.js';

// A client showing a person ship's exchange tells where its history ends
// (aeolus-fleet-gateway #321): the fleet's retention as the real core answers
// it to the gateway's ship presenting a person's account token. Core decides
// by the account's scopes and the token's fleet, never by the ship's own: two
// fleets of one core keep different retention.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const ACME = { days: 30, keptFrom: '2026-10-02T09:01:03.000Z' };
const GLOBEX = { days: 7, keptFrom: '2026-11-01T00:00:00.000Z' };
const createdSchema = z.object({ result: z.object({ data: z.object({ fleetId: idSchema('fleet'), operatorShipId: idSchema('ship') }) }) });

interface TestFleet {
  fleetId: FleetId;
  /** The gateway's crew token in this fleet: the ship holds no scope at all. */
  gatewayCrewToken: string;
  /** The same ship's token, but a ship that holds fleet:read of its own. */
  readerCrewToken: string;
}

let issuer: AccountIssuer;
let database: PrismaClient;
let server: FastifyInstance;
let url: string;
let acme: TestFleet;
let globex: TestFleet;

async function aFleet(name: string, retention: { days: number; keptFrom: string }): Promise<TestFleet> {
  const response = await fetch(`${url}/trpc/installation.fleets.create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aeolus-installation-token': INSTALLATION_TOKEN },
    body: JSON.stringify({ requestId: newKey(), name, operatorEmail: `${name}@example.com` }),
  });
  const { fleetId, operatorShipId } = createdSchema.parse(await response.json()).result.data;
  await database.$executeRaw`UPDATE "fleets" SET "retention_set" = true, "retention_days" = ${retention.days}, "kept_from" = ${retention.keptFrom}::timestamptz WHERE "id" = ${fleetId}`;
  const useCases = createUseCases({ prisma: database });
  const argo: ShipCaller = { shipId: operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] };
  const crewTokenOf = async (shipName: string, scopes: string[]): Promise<string> => {
    const ship = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: shipName, type: 'gateway', kind: 'app', scopes }));
    return unwrap(await useCases.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'CLOUD' }, harness: 'gateway' })).crewToken;
  };
  return { fleetId, gatewayCrewToken: await crewTokenOf('gateway', []), readerCrewToken: await crewTokenOf('reader', ['fleet:read']) };
}

beforeAll(async () => {
  issuer = await startAccountIssuer();
  const databaseUrl = await aMigratedDatabase(inject('postgresUrl'));
  database = createPrismaClient(databaseUrl);
  server = createApp({ databaseUrl, publicUrl: 'https://fleet.example.com', logger: false, installationToken: INSTALLATION_TOKEN, accountTokenIssuer: issuer.issuer });
  url = await server.listen({ host: '127.0.0.1', port: 0 });
  acme = await aFleet('acme', ACME);
  globex = await aFleet('globex', GLOBEX);
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
  await issuer.close();
});

function accountToken(fleet: TestFleet, scopes: readonly string[]): string {
  return issuer.tokenFor({ accountId: 'acc-mathilde', fleetId: fleet.fleetId, scopes });
}

describe("the fleet's retention, as core answers it to a person's account", () => {
  it("is the person's fleet's days and keptFrom, through a gateway ship that holds no scope of its own", async () => {
    const read = await createFleetRetention(url).retention({ crewToken: acme.gatewayCrewToken, accountToken: accountToken(acme, ['fleet:read']) });

    expect(read).toEqual({ isOk: true, value: ACME });
  });

  it("is each fleet's own retention, chosen by the account token's fleet", async () => {
    const read = await createFleetRetention(url).retention({ crewToken: globex.gatewayCrewToken, accountToken: accountToken(globex, ['fleet:read']) });

    expect(read).toEqual({ isOk: true, value: GLOBEX });
  });

  it("is refused to an account that holds no fleet:read, whatever its ship holds", async () => {
    const read = await createFleetRetention(url).retention({ crewToken: acme.readerCrewToken, accountToken: accountToken(acme, []) });

    expect(read).toMatchObject({ isOk: false, error: { code: 'FORBIDDEN' } });
  });

  it("is refused without the account's token to a gateway ship that holds no scope: the token decides", async () => {
    const read = await createFleetRetention(url).retention({ crewToken: acme.gatewayCrewToken });

    expect(read).toMatchObject({ isOk: false, error: { code: 'FORBIDDEN' } });
  });

  it("is refused when the account's token is for another fleet than the ship's", async () => {
    const read = await createFleetRetention(url).retention({ crewToken: acme.gatewayCrewToken, accountToken: accountToken(globex, ['fleet:read']) });

    expect(read.isOk).toBe(false);
  });
});
