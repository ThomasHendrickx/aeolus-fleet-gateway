/**
 * What a party's change form asks of the API (decision 0056): only what
 * differs from the party as the fleet holds it. Scope rows it did not show
 * revoke nothing; the scopes every app ship gets, and those the actor does
 * not hold, are never changed.
 */
import { idSchema } from '@aeolus-fleet/common';

/** The scopes every app ship gets (0046): shown locked on, and never changed. */
export const EVERY_APP_SHIP_SCOPES: readonly string[] = ['messages:send', 'messages:receive'];

/** A form field that ticks a scope: `scope:<scope>`, one field per scope. */
export const SCOPE_FIELD_PREFIX = 'scope:';

/** The field a change form sends when it shows the scope rows. */
export const SCOPES_SHOWN_FIELD = 'scopesShown';

export type Changes = { kind: 'changes'; ownerShipId?: string; grant: string[]; revoke: string[] } | { kind: 'refused'; message: string };

export function changesOf(party: { ownerShipId: string | null; scopes: readonly string[] | null }, sent: { form: Readonly<Record<string, string>>; scopes: readonly string[] }): Changes {
  const { form, scopes } = sent;
  const sentOwner = form.ownerShipId?.trim();
  let ownerShipId: string | undefined;
  if (sentOwner !== undefined && sentOwner !== party.ownerShipId) {
    const parsed = idSchema('ship').safeParse(sentOwner);
    if (!parsed.success) {
      return { kind: 'refused', message: "The owner's ship id is not a ship id (shp_...)" };
    }
    ownerShipId = parsed.data;
  }
  const owner = ownerShipId === undefined ? {} : { ownerShipId };
  const held = party.scopes;
  if (form[SCOPES_SHOWN_FIELD] !== 'true' || held === null) {
    return { kind: 'changes', ...owner, grant: [], revoke: [] };
  }
  const own = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.includes(scope));
  const isTicked = (scope: string) => form[`${SCOPE_FIELD_PREFIX}${scope}`] !== undefined;
  return {
    kind: 'changes',
    ...owner,
    grant: own.filter((scope) => isTicked(scope) && !held.includes(scope)),
    revoke: own.filter((scope) => !isTicked(scope) && held.includes(scope)),
  };
}
