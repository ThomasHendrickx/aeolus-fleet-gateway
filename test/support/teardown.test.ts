import { describe, expect, it } from 'vitest';

import { settleAll, stopAll } from './teardown.js';

describe('a failed setup', () => {
  it('stops what it had started and gives no second error', async () => {
    const stopped: string[] = [];
    let app: { close(): Promise<void> } | undefined;
    let fleet: { stop(): Promise<void> } | undefined;
    let double: { close(): Promise<void> } | undefined;

    const setup = settleAll([
      Promise.resolve({ stop: () => Promise.resolve(void stopped.push('fleet')) }).then((started) => (fleet = started)),
      new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('the double did not start')), 10)),
      new Promise<{ close(): Promise<void> }>((resolve) => setTimeout(() => resolve({ close: () => Promise.resolve(void stopped.push('double')) }), 30)).then((started) => (double = started)),
    ]);
    await expect(setup).rejects.toThrow('the double did not start');

    await expect(stopAll([() => app?.close(), () => double?.close(), () => fleet?.stop()])).resolves.toBeUndefined();
    expect(stopped.sort()).toEqual(['double', 'fleet']);
    app = undefined;
  });

  it('stops every resource even when one stop fails, then reports the first failure', async () => {
    const stopped: string[] = [];

    await expect(
      stopAll([
        () => Promise.reject(new Error('app would not close')),
        () => Promise.resolve(void stopped.push('fleet')),
      ]),
    ).rejects.toThrow('app would not close');
    expect(stopped).toEqual(['fleet']);
  });
});
