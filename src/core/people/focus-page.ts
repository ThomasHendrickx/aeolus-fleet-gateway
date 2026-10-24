import type { Sleep } from '../mcp-out/run-party.js';
import type { Clock } from '../shared/clock.js';
import type { FocusedPages, PersonShip } from './ports.js';

export type FocusPage = (page: PersonShip & { pageId: string }, signal: AbortSignal) => Promise<void>;

/**
 * Use case: a page of a person is in focus while it holds this open
 * (wake a person, W6). It counts in focus at once and is seen again every
 * while, so a page whose gateway instance stopped stops counting soon after;
 * once it loses focus or its connection, it is forgotten.
 */
export function createFocusPage(deps: { focused: FocusedPages; clock: Clock; sleep: Sleep; seenEveryMs: number }): FocusPage {
  return async ({ fleetId, shipId, pageId }, signal) => {
    try {
      while (!signal.aborted) {
        await deps.focused.save({ fleetId, shipId, pageId, seenAt: deps.clock.now() });
        await deps.sleep(deps.seenEveryMs, signal);
      }
    } finally {
      await deps.focused.remove(fleetId, pageId);
    }
  };
}
