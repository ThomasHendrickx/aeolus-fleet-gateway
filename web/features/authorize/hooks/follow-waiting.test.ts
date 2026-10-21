import { beforeEach, describe, expect, it } from 'vitest';

import { followWaiting, type LiveChannel } from './follow-waiting';

/** A live channel the test drives: it opens, tells and closes as the gateway's would. */
interface FakeChannel extends LiveChannel {
  url: string;
  isClosed: boolean;
}

let channels: FakeChannel[];
let wentTo: string[];
let timers: { delayMs: number; run: () => void; isCleared: boolean }[];

beforeEach(() => {
  channels = [];
  wentTo = [];
  timers = [];
});

const NOW = Date.parse('2026-10-21T09:00:00.000Z');

function follow() {
  return followWaiting('w 1', {
    now: () => NOW,
    origin: { protocol: 'https:', host: 'gateway.example.com' },
    open: (url) => {
      const channel: FakeChannel = {
        url,
        isClosed: false,
        close: () => {
          channel.isClosed = true;
        },
      };
      channels.push(channel);
      return channel;
    },
    goOn: (url) => {
      wentTo.push(url);
    },
    later: (run, delayMs) => {
      const timer = { delayMs, run, isCleared: false };
      timers.push(timer);
      return () => {
        timer.isCleared = true;
      };
    },
  });
}

function latest(): FakeChannel {
  const channel = channels.at(-1);
  if (channel === undefined) {
    throw new Error('no channel opened');
  }
  return channel;
}

describe('the waiting page follows its request live', () => {
  it("opens the gateway's live channel for its waiting, on the page's own origin", () => {
    follow();

    expect(channels.map(({ url }) => url)).toEqual(['wss://gateway.example.com/authorize/waiting/live?waiting=w+1']);
  });

  it("goes on to the gateway's waiting address once told to", () => {
    follow();

    latest().onMessage?.(JSON.stringify({ go: true }));

    expect(wentTo).toEqual(['/authorize/waiting?waiting=w+1']);
  });

  it('goes on by itself when its request expires', () => {
    follow();

    latest().onMessage?.(JSON.stringify({ expiresAt: '2026-10-21T10:00:00.000Z' }));
    const [expiry] = timers;
    expiry?.run();

    expect({ delayMs: expiry?.delayMs, wentTo }).toEqual({ delayMs: 3_600_000, wentTo: ['/authorize/waiting?waiting=w+1'] });
  });

  it('opens a dropped channel again, waiting longer each time, and from the start once it opened', () => {
    follow();

    latest().onClose?.(1006);
    timers.at(-1)?.run();
    latest().onClose?.(1006);
    timers.at(-1)?.run();
    latest().onOpen?.();
    latest().onClose?.(1006);

    expect({ opened: channels.length, delays: timers.map(({ delayMs }) => delayMs) }).toEqual({ opened: 3, delays: [500, 1000, 500] });
  });

  it('does not open again a channel the gateway closed for good', () => {
    follow();

    latest().onClose?.(4403);

    expect({ opened: channels.length, timers: timers.length }).toEqual({ opened: 1, timers: 0 });
  });

  it('closes its channel and opens none again once the page goes', () => {
    const stop = follow();

    stop();
    latest().onClose?.(1006);

    expect({ isClosed: latest().isClosed, timers: timers.length }).toEqual({ isClosed: true, timers: 0 });
  });

  it('ignores what it cannot read', () => {
    follow();

    latest().onMessage?.('not json');
    latest().onMessage?.(JSON.stringify({ something: 'else' }));

    expect({ wentTo, timers: timers.length }).toEqual({ wentTo: [], timers: 0 });
  });
});
