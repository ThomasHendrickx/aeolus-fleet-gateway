/** Hand-written wake hints: tests decide when a lease is told to look. */
import type { ShipLooks, ShipWakeups } from '../../src/core/connection/ship-wakeups.js';
import type { Sleep } from '../../src/core/mcp-out/run-party.js';

export function memoryShipWakeups() {
  const leases: { token: string; signal: AbortSignal; hints: ShipLooks; end(): void }[] = [];
  const open: ShipWakeups = (token, signal) => {
    const state = { isPending: false, isClosed: signal.aborted, isEnded: false };
    let waiting: ((isReady: boolean) => void) | undefined;
    const close = () => { state.isClosed = true; waiting?.(false); waiting = undefined; };
    signal.addEventListener('abort', close, { once: true });
    const hints: ShipLooks = {
      wait: () => {
        if (state.isClosed) { return Promise.resolve(false); }
        if (state.isPending) { state.isPending = false; return Promise.resolve(true); }
        return new Promise((resolve) => { waiting = resolve; });
      },
      request: () => {
        if (state.isClosed) { return; }
        if (waiting === undefined) { state.isPending = true; } else { const resolve = waiting; waiting = undefined; resolve(true); }
      },
      isEnded: () => state.isEnded,
      close,
    };
    leases.push({ token, signal, hints, end: () => { state.isEnded = true; close(); } });
    return hints;
  };
  return { open, leases, wake: () => { for (const lease of leases) { lease.hints.request(); } } };
}

/** Existing delivery tests advance one wake per scripted fleet round. */
export function scriptedShipWakeups(sleep: Sleep, intervalMs: number): ShipWakeups {
  return (_token, signal) => {
    let isFirst = true;
    let isRequested = false;
    return {
      wait: async () => { if (!isFirst && !isRequested) { await sleep(intervalMs, signal); } isFirst = false; isRequested = false; return !signal.aborted; },
      request: () => { isRequested = true; },
      isEnded: () => false,
      close: () => undefined,
    };
  };
}
