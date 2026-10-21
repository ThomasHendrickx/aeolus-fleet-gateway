/**
 * How the waiting page follows its request on the gateway's live channel:
 * it goes to the gateway's waiting address once told to, there to be sent
 * on, and goes there too when the request expires. A dropped channel opens
 * again with backoff. It never reloads on a timer.
 */
import { WAITING_DOOR } from '../services/authorize';

/** Why the gateway closed the live channel for good: it was not opened from the waiting page. */
const CLOSE_OTHER_ORIGIN = 4403;
const FIRST_RETRY_MS = 500;
const LAST_RETRY_MS = 10_000;

/** The live channel as the page follows it: what it is told, and when it opens and closes. */
export interface LiveChannel {
  onOpen?: () => void;
  onMessage?: (data: unknown) => void;
  onClose?: (code: number) => void;
  close(): void;
}

export interface FollowWaitingDeps {
  origin: { protocol: string; host: string };
  open(url: string): LiveChannel;
  goOn(url: string): void;
  /** Runs later, answering how to cancel it. */
  later(run: () => void, delayMs: number): () => void;
  now(): number;
}

/** Whether the live channel says to go on, or when the request expires. */
function toldOf(data: unknown): 'goOn' | { expiresAt: string } | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  let told: unknown;
  try {
    told = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof told !== 'object' || told === null) {
    return undefined;
  }
  if ('go' in told && told.go === true) {
    return 'goOn';
  }
  return 'expiresAt' in told && typeof told.expiresAt === 'string' ? { expiresAt: told.expiresAt } : undefined;
}

/** Follows the waiting until it goes on; answers how to stop, as the page goes. */
export function followWaiting(waiting: string, deps: FollowWaitingDeps): () => void {
  const asked = new URLSearchParams({ waiting }).toString();
  const door = `${WAITING_DOOR}?${asked}`;
  const live = `${deps.origin.protocol === 'https:' ? 'wss:' : 'ws:'}//${deps.origin.host}${WAITING_DOOR}/live?${asked}`;
  let retry = FIRST_RETRY_MS;
  let cancelExpiry: (() => void) | undefined;
  let cancelReopen: (() => void) | undefined;
  let channel: LiveChannel | undefined;
  let isLeft = false;
  const open = () => {
    const opened = deps.open(live);
    channel = opened;
    opened.onOpen = () => {
      retry = FIRST_RETRY_MS;
    };
    opened.onMessage = (data) => {
      const told = toldOf(data);
      if (told === undefined) {
        return;
      }
      if (told === 'goOn') {
        deps.goOn(door);
        return;
      }
      cancelExpiry?.();
      cancelExpiry = deps.later(() => {
        deps.goOn(door);
      }, Math.max(0, Date.parse(told.expiresAt) - deps.now()));
    };
    opened.onClose = (code) => {
      if (isLeft || code === CLOSE_OTHER_ORIGIN) {
        return;
      }
      cancelReopen = deps.later(open, retry);
      retry = Math.min(retry * 2, LAST_RETRY_MS);
    };
  };
  open();
  return () => {
    isLeft = true;
    cancelExpiry?.();
    cancelReopen?.();
    channel?.close();
  };
}
