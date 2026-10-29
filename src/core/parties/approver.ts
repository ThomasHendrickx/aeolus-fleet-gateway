import type { Actor } from '../actors/authenticate-actor.js';

/** The scope the gateway declares for approving outside parties (decision 0056). */
export const APPROVING_SCOPE = 'gateway:approve';

/** The scopes every app ship gets (decision 0046), so an approver need not hold them to grant them. */
export const EVERY_APP_SHIP_SCOPES: ReadonlySet<string> = new Set(['messages:send', 'messages:receive']);

/** The first scope an approver grants a party but does not hold itself, if any: an approver grants only scopes it holds. */
export function scopeNotHeld(approver: Actor, scopes: readonly string[]): string | undefined {
  return scopes.find((scope) => !EVERY_APP_SHIP_SCOPES.has(scope) && !approver.scopes.includes(scope));
}
