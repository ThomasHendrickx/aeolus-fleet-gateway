import { grantScopesOutputSchema } from '@aeolus-fleet/common';

import type { ProxyShipsAsActor } from '../../core/parties/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { mutateAs, readAs } from './actor-door.js';

/** A party's proxy ship, as the actor calls the fleet on it (decision 0057). */
export function createProxyShipsAsActor(fleetUrl: string): ProxyShipsAsActor {
  return {
    retire: async (as, { shipId }) => {
      const retired = await mutateAs(fleetUrl, { as, procedure: 'retire', input: { shipId } });
      return retired.isOk ? ok(undefined) : err(retired.error);
    },
    setOwner: async (as, { shipId, ownerShipId }) => {
      const set = await mutateAs(fleetUrl, { as, procedure: 'setOwner', input: { shipId, ownerShipId }, isTrpcOnly: true });
      return set.isOk ? ok(undefined) : err(set.error);
    },
    grantScopes: async (as, { shipId, grant, revoke }) => {
      const changed = await mutateAs(fleetUrl, { as, procedure: 'grantScopes', input: { shipId, grant, revoke } });
      if (!changed.isOk) {
        return changed;
      }
      const held = grantScopesOutputSchema.safeParse(changed.value);
      return held.success ? ok({ scopes: [...held.data.scopes] }) : err({ code: 'UNAVAILABLE', message: 'The fleet answered no scopes' });
    },
    checkManage: async (as, { shipId }) => {
      const checked = await readAs(fleetUrl, { as, procedure: 'checkManage', input: { shipId } });
      return checked.isOk ? ok(undefined) : err(checked.error);
    },
  };
}
