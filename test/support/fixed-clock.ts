import type { Clock } from "../../src/core/shared/clock.js";

/** A clock that stands still, for a test that never ages what the gateway holds. */
export const FIXED_CLOCK: Clock = {
  now: () => new Date("2026-11-08T10:00:00.000Z"),
};
