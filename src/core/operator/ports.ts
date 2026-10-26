import type { FleetId, ScopeName } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/** A signed-in console session: argo's or a viewer's, with its ship's scopes, or an account's, with its account token's; the fleet's own scopes among them (gateway scopes 4.1). */
export type ConsoleSession =
  | { fleetId: FleetId; kind: 'operator' | 'viewer'; scopes: readonly ScopeName[] }
  | { fleetId: FleetId; kind: 'account'; accountId: string; scopes: readonly ScopeName[] };

/**
 * Outbound port: asks the fleet whose a forwarded console session cookie is
 * (`console.session`, decisions 0012, 0022, 0043 and 0053).
 */
export interface ConsoleSessions {
  check(cookie: string): Promise<Result<ConsoleSession, FleetRefusal>>;
}
