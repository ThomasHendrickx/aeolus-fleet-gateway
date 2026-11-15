import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { memoryShipWakeups } from '../../../test/support/ship-wakeups.js';
import type { GatewayCrew } from './ports.js';
import { createWatchGatewayShips } from './watch-gateway-ships.js';

const FIRST: GatewayCrew = { fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'first', crewedAt: new Date('2026-11-01') };
const SECOND: GatewayCrew = { ...FIRST, fleetId: OTHER_FLEET_ID, crewToken: 'second' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function setup() {
  const connections = memoryConnectionStore();
  await connections.save(FIRST);
  const streams = memoryShipWakeups();
  const looked: string[] = [];
  const state = { isOn: true };
  const watcher = createWatchGatewayShips({ connections, wakeups: streams.open, isServed: () => Promise.resolve(state.isOn), look: (crew) => { looked.push(crew.crewToken); return Promise.resolve(); }, failed: () => undefined });
  return { connections, streams, looked, state, watcher };
}

describe('the gateway own leases', () => {
  it('reconciles one stream per connected served lease and receives stored work on the open wake after restart', async () => {
    const test = await setup();
    const stored = ['before shutdown', 'while stream down'];
    const received: string[] = [];
    const watcher = createWatchGatewayShips({ connections: test.connections, wakeups: test.streams.open, isServed: () => Promise.resolve(true), look: () => { received.push(...stored.splice(0)); return Promise.resolve(); }, failed: () => undefined });
    await watcher.reconcile();
    await watcher.reconcile();
    expect(test.streams.leases).toHaveLength(1);
    expect(received).toEqual([]);
    test.streams.wake();
    await tick();
    expect(received).toEqual(['before shutdown', 'while stream down']);
    await watcher.stop();
  });
  it('a wake during an in-flight look causes exactly one more serialized look', async () => {
    const test = await setup();
    let release: (() => void) | undefined;
    let looks = 0;
    const watcher = createWatchGatewayShips({ connections: test.connections, wakeups: test.streams.open, isServed: () => Promise.resolve(true), look: async () => { looks += 1; if (looks === 1) { await new Promise<void>((resolve) => { release = resolve; }); } }, failed: () => undefined });
    await watcher.reconcile();
    test.streams.wake();
    await tick();
    test.streams.wake(); test.streams.wake(); test.streams.wake();
    await tick();
    expect(looks).toBe(1);
    release?.();
    await tick();
    expect(looks).toBe(2);
    await watcher.stop();
  });
  it('one slow fleet does not block another fleet', async () => {
    const test = await setup();
    await test.connections.save(SECOND);
    const looked: string[] = [];
    let release: (() => void) | undefined;
    const watcher = createWatchGatewayShips({ connections: test.connections, wakeups: test.streams.open, isServed: () => Promise.resolve(true), look: async (crew) => { if (crew.crewToken === 'first') { await new Promise<void>((resolve) => { release = resolve; }); } looked.push(crew.crewToken); }, failed: () => undefined });
    await watcher.reconcile();
    test.streams.wake();
    await tick();
    expect(looked).toEqual(['second']);
    release?.();
    await watcher.stop();
  });
  it('closes disconnected, replaced and disabled leases without forgetting a replacement', async () => {
    const test = await setup();
    await test.watcher.reconcile();
    await test.connections.save({ ...FIRST, crewToken: 'replacement' });
    await test.watcher.reconcile();
    expect(test.streams.leases[0]?.signal.aborted).toBe(true);
    test.streams.leases[0]?.end();
    await tick();
    expect((await test.connections.find(FLEET_ID))?.crewToken).toBe('replacement');
    test.state.isOn = false;
    await test.watcher.reconcile();
    expect(test.streams.leases[1]?.signal.aborted).toBe(true);
    test.state.isOn = true;
    await test.watcher.reconcile();
    await test.connections.drop(FLEET_ID);
    await test.watcher.reconcile();
    expect(test.streams.leases[2]?.signal.aborted).toBe(true);
    await test.watcher.stop();
  });
  it('drops only the ended lease and shutdown aborts streams with no reopening', async () => {
    const test = await setup();
    await test.watcher.reconcile();
    test.streams.leases[0]?.end();
    await tick();
    expect(await test.connections.find(FLEET_ID)).toBeUndefined();
    await test.connections.save(SECOND);
    await test.watcher.reconcile();
    await test.watcher.stop();
    expect(test.streams.leases[1]?.signal.aborted).toBe(true);
    await test.watcher.reconcile();
    test.streams.wake();
    await tick();
    expect(test.streams.leases).toHaveLength(2);
    expect(test.looked).toEqual([]);
  });
});
