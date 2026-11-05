import { describe, expect, it } from 'vitest';

import type { YourFleet } from '../../../../bridge/fleet/services/your-fleet';
import { alertShipOf, isSendable, keyToSend, sendableShipsOf, sendFailureOf, sentNoticeOf, shipsMatching } from './send-message';

// Bridge's form to send a ship a message (aeolus-fleet #1547, send-message.html).

describe('the ships the form offers as the person types', () => {
  const ships = [
    { name: 'builder-core', state: 'working' as const },
    { name: 'builder-gateway', state: 'alert' as const },
    { name: 'orchestrator-1', state: null },
  ];

  it('offers every ship the person ship may send to while nothing is typed', () => {
    expect(shipsMatching(ships, '')).toEqual(ships);
  });

  it('offers the ships whose name holds what is typed, whatever its case', () => {
    expect(shipsMatching(ships, ' Build').map(({ name }) => name)).toEqual(['builder-core', 'builder-gateway']);
  });
});

describe('each ship the form offers, with its state as Your fleet shows it', () => {
  /** Your fleet as the person reads it: builder-ui is idle, builder-core working, builder-gateway has an alert, orchestrator-1 is blocked. */
  const FLEET: YourFleet = {
    shipCount: 4,
    counts: { alert: 1, awaitingCrew: 0, blocked: 1, working: 1, idle: 1 },
    groups: [
      {
        group: 'agents',
        tiles: [
          { shipId: 'shp_01m3tbfspe96yf1rnr4ank9bgw', name: 'builder-gateway', state: 'alert', note: null, lastActivityAt: null },
          { shipId: 'shp_01m3tbfspe96yf1rnr4ank9or1', name: 'orchestrator-1', state: 'blocked', note: null, lastActivityAt: null },
          { shipId: 'shp_01m3tbfspe96yf1rnr4ank9bco', name: 'builder-core', state: 'working', note: null, lastActivityAt: null },
          { shipId: 'shp_01m3tbfspe96yf1rnr4ank9bui', name: 'builder-ui', state: 'idle', note: null, lastActivityAt: null },
        ],
      },
    ],
  };

  it("offers only the ships the person ship may send to, each in Your fleet's state, alerts first, then awaiting crew, blocked, working and idle", () => {
    expect(sendableShipsOf(['builder-core', 'builder-gateway', 'builder-ui'], FLEET)).toEqual([
      { name: 'builder-gateway', state: 'alert' },
      { name: 'builder-core', state: 'working' },
      { name: 'builder-ui', state: 'idle' },
    ]);
  });

  it('offers a ship Your fleet does not show with no state, after the others', () => {
    expect(sendableShipsOf(['argo', 'builder-ui'], FLEET)).toEqual([
      { name: 'builder-ui', state: 'idle' },
      { name: 'argo', state: null },
    ]);
  });

  it('offers every ship with no state when Your fleet could not be read', () => {
    expect(sendableShipsOf(['builder-ui', 'argo'], undefined)).toEqual([
      { name: 'argo', state: null },
      { name: 'builder-ui', state: null },
    ]);
  });
});

describe('when Send is on', () => {
  it('is off until a ship is picked', () => {
    expect(isSendable({ to: null, message: 'Report where you are' })).toBe(false);
  });

  it('is off while nothing but blanks is written', () => {
    expect(isSendable({ to: 'builder-gateway', message: ' \n ' })).toBe(false);
  });

  it('is on once a ship is picked and something is written', () => {
    expect(isSendable({ to: 'builder-gateway', message: 'Report where you are' })).toBe(true);
  });
});

describe('the key a send carries', () => {
  const sent = { key: 'key-1', to: 'builder-gateway', message: 'Report where you are' };

  it('is the same key when the same message goes to the same ship again, so it arrives once', () => {
    expect(keyToSend({ last: sent, to: 'builder-gateway', message: 'Report where you are', newKey: 'key-2' })).toBe('key-1');
  });

  it('is a new key once the person picked another ship', () => {
    expect(keyToSend({ last: sent, to: 'builder-core', message: 'Report where you are', newKey: 'key-2' })).toBe('key-2');
  });

  it('is a new key once the person changed the message', () => {
    expect(keyToSend({ last: sent, to: 'builder-gateway', message: 'Report where you are, please', newKey: 'key-2' })).toBe('key-2');
  });

  it('is a new key for the first send', () => {
    expect(keyToSend({ last: null, to: 'builder-gateway', message: 'Report where you are', newKey: 'key-2' })).toBe('key-2');
  });
});

describe('why a send failed', () => {
  it('is a refusal when the fleet refused it, in its own words', () => {
    expect(sendFailureOf({ code: 'BAD_REQUEST', message: 'The fleet did not take your message: No active ship is named builder-gateway' })).toEqual({
      kind: 'refused',
      reason: 'The fleet did not take your message: No active ship is named builder-gateway',
    });
  });

  it.each([
    ['the fleet gave no answer', 'BAD_GATEWAY'],
    ['the gateway gave no answer', undefined],
    ['the fleet was busy', 'SERVICE_UNAVAILABLE'],
  ])('is no answer when %s, as the message may be stored', (_, code) => {
    expect(sendFailureOf({ code, message: 'The fleet did not answer: fetch failed' })).toEqual({ kind: 'noAnswer' });
  });
});

describe('what the toast says once the fleet stored it', () => {
  it('names the ship, when the fleet stored it in UTC, and the person ship it was sent as', () => {
    expect(sentNoticeOf({ to: 'builder-gateway', sentAs: 'argo', storedAt: '2026-10-31T19:52:30.000Z' })).toEqual({
      title: 'Sent to builder-gateway',
      description: 'Stored by the fleet at 19:52 UTC, sent as argo. builder-gateway receives it when it next looks.',
    });
  });
});

describe('the ship an opened alert is about', () => {
  const alert = (payload: unknown) => ({ contentType: 'application/vnd.aeolus.alert+json', payload: JSON.stringify(payload) });

  it("is the alert's ship, by name", () => {
    expect(alertShipOf(alert({ headline: 'builder-gateway: no report change for 2 h', body: '', ship: { id: 'shp_01m3tbfspe96yf1rnr4ank9bgw', name: 'builder-gateway' } }))).toBe('builder-gateway');
  });

  it('is none for any other message', () => {
    expect(alertShipOf({ contentType: 'text/plain', payload: '{"ship":{"name":"builder-gateway"}}' })).toBeUndefined();
  });

  it('is none for an alert whose payload does not read', () => {
    expect(alertShipOf({ contentType: 'application/vnd.aeolus.alert+json', payload: 'not json' })).toBeUndefined();
  });
});
