'use client';

import { useEffect } from 'react';

import { WAITING_DOOR } from '../services/authorize';

/** Why the gateway closed the live channel for good: it was not opened from the waiting page. */
const CLOSE_OTHER_ORIGIN = 4403;
const FIRST_RETRY_MS = 500;
const LAST_RETRY_MS = 10_000;

/** Whether the live channel says to go on, or when the request expires. */
function toldOf(data: unknown): 'goOn' | { expiresAt: string } | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  const told: unknown = JSON.parse(data);
  if (typeof told !== 'object' || told === null) {
    return undefined;
  }
  if ('go' in told && told.go === true) {
    return 'goOn';
  }
  return 'expiresAt' in told && typeof told.expiresAt === 'string' ? { expiresAt: told.expiresAt } : undefined;
}

/**
 * Follows a request on the gateway's live channel and goes to the
 * gateway's waiting address once told to, there to be sent on; it goes
 * there too when the request expires. A dropped channel opens again with
 * backoff. It never reloads on a timer.
 */
export function useFollowWaiting(waiting: string): void {
  useEffect(() => {
    const door = `${WAITING_DOOR}?${new URLSearchParams({ waiting }).toString()}`;
    const goOn = () => {
      location.replace(door);
    };
    let retry = FIRST_RETRY_MS;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let isLeft = false;
    const open = () => {
      const live = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${WAITING_DOOR}/live?${new URLSearchParams({ waiting }).toString()}`);
      socket = live;
      live.onopen = () => {
        retry = FIRST_RETRY_MS;
      };
      live.onmessage = (event) => {
        const told = toldOf(event.data);
        if (told === undefined) {
          return;
        }
        if (told === 'goOn') {
          goOn();
          return;
        }
        clearTimeout(expiry);
        expiry = setTimeout(goOn, Math.max(0, Date.parse(told.expiresAt) - Date.now()));
      };
      live.onclose = (event) => {
        if (isLeft || event.code === CLOSE_OTHER_ORIGIN) {
          return;
        }
        reopen = setTimeout(open, retry);
        retry = Math.min(retry * 2, LAST_RETRY_MS);
      };
    };
    open();
    return () => {
      isLeft = true;
      clearTimeout(expiry);
      clearTimeout(reopen);
      socket?.close();
    };
  }, [waiting]);
}
