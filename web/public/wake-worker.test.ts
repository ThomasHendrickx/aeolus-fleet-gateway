import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

// The gateway's service worker shows each wake as the browser's notification
// (wake a person, W4): for what waits at argo, a notification of its own,
// saying so and that it is not for the person alone (argo's inbox, AI4, AI5).

const WORKER = readFileSync(new URL('wake-worker.js', import.meta.url), 'utf8');

/** The notification the worker shows for a push carrying the wake. */
async function shownFor(wake: unknown): Promise<{ title: string; options: { body: string; data: unknown; tag: string } }> {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: { body: string; data: unknown; tag: string } }[] = [];
  let waited: Promise<unknown> = Promise.resolve();
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    registration: {
      showNotification: (title: string, options: { body: string; data: unknown; tag: string }) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  runInNewContext(WORKER, { self });
  listeners.get('push')?.({ data: { json: () => wake }, waitUntil: (promise: Promise<unknown>) => (waited = promise) });
  await waited;
  const [notification] = shown;
  if (notification === undefined) {
    throw new Error('the worker showed no notification');
  }
  return notification;
}

const BRIDGE_URL = 'https://bridge.aeolus-fleet.dev/bridge';

describe("the service worker's notification of a wake", () => {
  it('says something waits at argo, not for the person alone, and links where their own wake links', async () => {
    await expect(shownFor({ fleetName: 'Aeolus fleet', bridgeUrl: BRIDGE_URL, waitsAt: 'argo' })).resolves.toEqual({
      title: 'Aeolus fleet: something waits at argo',
      options: { body: 'Not for you alone: for everyone allowed as argo.', data: { bridgeUrl: BRIDGE_URL }, tag: 'aeolus-argo-wake' },
    });
  });

  it("keeps the person's own wake as it is, under its own tag", async () => {
    await expect(shownFor({ fleetName: 'Aeolus fleet', bridgeUrl: BRIDGE_URL, waitsAt: 'personShip' })).resolves.toEqual({
      title: 'Aeolus fleet',
      options: { body: 'Something waits for you.', data: { bridgeUrl: BRIDGE_URL }, tag: 'aeolus-wake' },
    });
  });
});
