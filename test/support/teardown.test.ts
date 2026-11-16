import { describe, expect, it } from 'vitest';

import { settleAll, stopAll } from './teardown.js';

describe('a failed setup', () => {
  it('stops what it had started and gives no second error', async () => {
    const stopped: string[] = [];
    /** The app, which a setup that failed before creating it never assigned. */
    const noApp = (): { close(): Promise<void> } | undefined => undefined;
    let fleet: { stop(): Promise<void> } | undefined;
    let double: { close(): Promise<void> } | undefined;

    const setup = settleAll([
      Promise.resolve({ stop: () => { stopped.push('fleet'); return Promise.resolve(); } }).then((started) => (fleet = started)),
      new Promise<void>((_resolve, reject) => setTimeout(() => {
          reject(new Error('the double did not start'));
        }, 10)),
      new Promise<{ close(): Promise<void> }>((resolve) => setTimeout(() => {
          resolve({
            close: () => {
              stopped.push('double');
              return Promise.resolve();
            },
          });
        }, 30)).then((started) => (double = started)),
    ]);
    await expect(setup).rejects.toThrow('the double did not start');

    await expect(stopAll([() => noApp()?.close(), () => double?.close(), () => fleet?.stop()])).resolves.toBeUndefined();
    expect(stopped.sort()).toEqual(['double', 'fleet']);
  });

  it('stops every resource even when one stop fails, then reports the first failure', async () => {
    const stopped: string[] = [];

    await expect(
      stopAll([
        () => Promise.reject(new Error('app would not close')),
        () => { stopped.push('fleet'); return Promise.resolve(); },
      ]),
    ).rejects.toThrow('app would not close');
    expect(stopped).toEqual(['fleet']);
  });
});
