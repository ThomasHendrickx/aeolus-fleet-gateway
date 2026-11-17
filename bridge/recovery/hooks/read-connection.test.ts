import { describe, expect, it } from 'vitest';

import { readConnection } from './read-connection';

describe('Bridge connection recovery', () => {
  it('names a disconnected gateway from its connection status', async () => {
    expect(await readConnection({ connection: { status: { query: () => Promise.resolve({ state: 'not-connected' }) } } })).toBe('disconnected');
  });

  it('keeps a connected gateway distinct from a fleet that did not answer', async () => {
    expect(await readConnection({ connection: { status: { query: () => Promise.resolve({ state: 'connected' }) } } })).toBe('connected');
  });

  it('does not call an unreadable connection disconnected', async () => {
    expect(await readConnection({ connection: { status: { query: () => Promise.reject(new Error('unavailable')) } } })).toBe('unreadable');
  });
});
