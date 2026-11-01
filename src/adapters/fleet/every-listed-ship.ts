import { fleetListOutputSchema, type fleetListInputSchema } from '@aeolus-fleet/common';
import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import type { z } from 'zod';

import type { ActorCredential } from '../../core/actors/credential-of.js';
import type { FleetRefusal } from '../../core/connection/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';

/** A ship fleet.list answers within the actor's read reach, whole. */
export type ListedInReach = Exclude<z.infer<typeof fleetListOutputSchema>['items'][number], { isInReadReach: false }>;

type ListFilter = Omit<NonNullable<z.input<typeof fleetListInputSchema>>, 'cursor' | 'limit'>;

/**
 * Every ship fleet.list answers the actor for the filter, within its read
 * reach, as only those carry their kind. The fleet answers a page at a time
 * (performance S6), so the list reads on from each page's next cursor until
 * it is null.
 */
export async function everyListedShip(fleetUrl: string, call: { as: ActorCredential; filter: ListFilter }): Promise<Result<ListedInReach[], FleetRefusal>> {
  const ships: ListedInReach[] = [];
  let cursor: string | undefined;
  do {
    const read = await readAs(fleetUrl, { as: call.as, procedure: 'list', input: { ...call.filter, ...(cursor === undefined ? {} : { cursor }), limit: PAGE_SIZE_MAX } });
    if (!read.isOk) {
      return read;
    }
    const page = fleetListOutputSchema.safeParse(read.value);
    if (!page.success) {
      return err({ code: 'UNAVAILABLE', message: 'The fleet answered no ships' });
    }
    ships.push(...page.data.items.flatMap((ship) => ('isInReadReach' in ship ? [] : [ship])));
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ok(ships);
}
