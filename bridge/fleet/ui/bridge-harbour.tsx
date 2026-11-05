'use client';

import { Harbour, type HarbourCounts, type HarbourGroupShips } from '@aeolus-fleet/ui';

import { healthHrefOf } from '../../../web/features/bridge/services/stay-aware';

/** Bridge draws Harbour only once Your fleet is read, so never its loading or error shape, and nothing to try again. */
function noRetry(): void {
  // Nothing: a fleet Bridge could not read shows Bridge's own line instead (FleetUnreadable).
}

/**
 * Your fleet drawn by Harbour from @aeolus-fleet/ui, the part the console's
 * fleet overview stands on, at Bridge's width (aeolus-fleet
 * docs/design/fleet-overview). A tile opens its ship's page in the fleet's
 * console; tiles are not links while the console is not known.
 */
export function BridgeHarbour({ counts, groups, consoleUrl, now }: { counts: HarbourCounts; groups: readonly HarbourGroupShips[]; consoleUrl: string | undefined; now: Date }) {
  return <Harbour counts={counts} groups={groups} now={now} hrefOf={consoleUrl === undefined ? undefined : (shipId) => healthHrefOf({ consoleUrl, shipId })} state="ready" onRetry={noRetry} />;
}
