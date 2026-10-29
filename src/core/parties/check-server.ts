import type { FleetId } from '@aeolus-fleet/common';

import type { McpServerConnection, McpServers } from '../mcp-out/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** A tool as the check shows it: its name, its short description when the server gives one, and whether the server says it reads only. */
export interface CheckedTool {
  name: string;
  description?: string;
  isReadOnly: boolean;
}

export type CheckServer = (input: { fleetId: FleetId } & McpServerConnection) => Promise<Result<{ tools: CheckedTool[] }, DomainError<'OUTSIDE_PARTIES_OFF' | 'SERVER_UNREACHABLE'>>>;

/**
 * Use case: the gateway checks an outside MCP server before it is added
 * (flow F10): the tools its server lists, with the credential the approver
 * typed. It keeps nothing and commissions nothing; approving does that.
 * Only while the fleet's outside parties are on, as approving.
 */
export function createCheckServer(deps: { servers: McpServers; servesOutsideParties: (fleetId: FleetId) => Promise<boolean> }): CheckServer {
  return async ({ fleetId, url, credential }) => {
    if (!(await deps.servesOutsideParties(fleetId))) {
      return refuse('OUTSIDE_PARTIES_OFF', "This fleet's outside parties are off: turn them on first");
    }
    const listed = await deps.servers.listTools({ url, credential });
    if (!listed.isOk) {
      return refuse('SERVER_UNREACHABLE', `The MCP server could not be listed: ${listed.error.reason}`);
    }
    return ok({ tools: listed.value.map(({ name, description, annotations }) => ({ name, ...(description === undefined ? {} : { description }), isReadOnly: annotations?.readOnlyHint === true })) });
  };
}
