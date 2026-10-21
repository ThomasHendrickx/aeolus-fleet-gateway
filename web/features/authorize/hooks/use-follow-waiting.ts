'use client';

import { useEffect } from 'react';

import { followWaiting, type LiveChannel } from './follow-waiting';

/** The browser's WebSocket as the waiting page's live channel. */
function webSocketChannel(url: string): LiveChannel {
  const socket = new WebSocket(url);
  const channel: LiveChannel = {
    close: () => {
      socket.close();
    },
  };
  socket.onopen = () => channel.onOpen?.();
  socket.onmessage = (event) => channel.onMessage?.(event.data);
  socket.onclose = (event) => channel.onClose?.(event.code);
  return channel;
}

/** Follows the page's request live while the page shows (follow-waiting.ts). */
export function useFollowWaiting(waiting: string): void {
  useEffect(
    () =>
      followWaiting(waiting, {
        origin: location,
        open: webSocketChannel,
        goOn: (url) => {
          location.replace(url);
        },
        later: (run, delayMs) => {
          const timer = setTimeout(run, delayMs);
          return () => {
            clearTimeout(timer);
          };
        },
        now: () => Date.now(),
      }),
    [waiting],
  );
}
