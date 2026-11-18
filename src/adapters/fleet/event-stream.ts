/** Shared SSE transport coalesces look requests and reconnects with bounded backoff. */
import type { ShipLooks, ShipWakeups } from '../../core/connection/ship-wakeups.js';

const SILENCE_MS = 60_000;
const SAFETY_MS = 300_000;
const MAX_BACKOFF_MS = 60_000;
const MIN_BACKOFF_MS = 1_000;
const BACKOFF_SPREAD_MS = 4_000;

export interface EventStreamOptions {
  fleetUrl: string;
  fetch?: typeof fetch;
  random?: () => number;
}

function isLeaseEnded(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'code' in body && body.code === 'LEASE_ENDED';
}

interface StreamProtocol {
  path: string;
  shouldLookOnOpen: boolean;
  accepts: (frame: { event: string; data: string }) => boolean;
}

export function createEventStream(options: EventStreamOptions, protocol: StreamProtocol): ShipWakeups & { request: (crewToken: string) => void; close: () => void } {
  const leases = new Map<string, ShipLooks>();
  const stopping = new AbortController();
  const watch: ShipWakeups = (crewToken, parentSignal) => {
    const signal = AbortSignal.any([parentSignal, stopping.signal]);
    const state = { isStopped: signal.aborted, isPending: false, isEnded: false };
    let waiting: ((look: boolean) => void) | undefined;
    let safety: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let abort: AbortController | undefined;
    const spread = () => MIN_BACKOFF_MS + (options.random ?? Math.random)() * BACKOFF_SPREAD_MS;
    let backoffMs = spread();
    let lastEventId: string | undefined;
    const isActive = () => !state.isStopped;
    const close = () => {
      state.isStopped = true;
      state.isPending = false;
      clearTimeout(safety);
      clearTimeout(retry);
      abort?.abort();
      waiting?.(false);
      waiting = undefined;
      signal.removeEventListener('abort', close);
      if (leases.get(crewToken) === hints) { leases.delete(crewToken); }
    };
    const ended = () => {
      state.isEnded = true;
      close();
    };
    const request = () => {
      if (state.isStopped) { return; }
      clearTimeout(safety);
      safety = setTimeout(request, SAFETY_MS);
      if (waiting === undefined) {
        state.isPending = true;
      } else {
        const resolve = waiting;
        waiting = undefined;
        resolve(true);
      }
    };
    const open = async (): Promise<void> => {
      if (state.isStopped) { return; }
      const controller = new AbortController();
      abort = controller;
      const isAborted = () => controller.signal.aborted;
      let silence = setTimeout(() => { controller.abort(); }, SILENCE_MS);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancel = () => { void reader?.cancel().catch(() => undefined); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        const headers: Record<string, string> = { authorization: `Bearer ${crewToken}`, accept: 'text/event-stream' };
        if (lastEventId !== undefined) { headers['Last-Event-ID'] = lastEventId; }
        const response = await (options.fetch ?? fetch)(`${options.fleetUrl}/api/v1/${protocol.path}`, {
          headers,
          signal: controller.signal,
        });
        if (response.status === 401 && isLeaseEnded(await response.json())) {
          ended();
          return;
        }
        if (!response.ok || response.body === null) {
          await response.body?.cancel();
          return;
        }
        reader = response.body.getReader();
        if (controller.signal.aborted) { return; }
        if (protocol.shouldLookOnOpen) { request(); }
        const decoder = new TextDecoder();
        let pending = '';
        let event = '';
        let data = '';
        let id = '';
        while (isActive() && !isAborted()) {
          const read = await reader.read();
          if (read.done) { break; }
          clearTimeout(silence);
          silence = setTimeout(() => { controller.abort(); }, SILENCE_MS);
          pending += decoder.decode(read.value, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline).replace(/\r$/, '');
            pending = pending.slice(newline + 1);
            if (line === '') {
              if (protocol.accepts({ event, data })) {
                if (/^\d+$/.test(id)) { lastEventId = id; }
                backoffMs = spread();
                request();
              } else if (event === 'end') {
                try { if (isLeaseEnded(JSON.parse(data))) { ended(); } } catch { /* Invalid events carry no authority. */ }
              }
              event = '';
              data = '';
              id = '';
            } else if (line.startsWith('id:')) {
              id = line.slice(3).trim();
            } else if (line.startsWith('event:')) {
              event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data += `${line.slice(5).trim()}\n`;
            }
          }
        }
      } catch {
        // A lost stream or refused opening always uses LD3, including FLEET_BUSY.
      } finally {
        clearTimeout(silence);
        controller.signal.removeEventListener('abort', cancel);
        await reader?.cancel().catch(() => undefined);
        if (isActive()) {
          retry = setTimeout(() => { void open(); }, backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
      }
    };
    if (!state.isStopped) {
      signal.addEventListener('abort', close, { once: true });
      safety = setTimeout(request, SAFETY_MS);
      void open();
    }
    const hints: ShipLooks = {
      wait: () => {
        if (state.isStopped) { return Promise.resolve(false); }
        if (state.isPending) {
          state.isPending = false;
          return Promise.resolve(true);
        }
        return new Promise((resolve) => { waiting = resolve; });
      },
      request,
      isEnded: () => state.isEnded,
      close,
    };
    if (isActive()) { leases.set(crewToken, hints); }
    return hints;
  };
  return Object.assign(watch, {
    request: (crewToken: string) => { leases.get(crewToken)?.request(); },
    close: () => { stopping.abort(); },
  });
}
