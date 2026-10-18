import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { McpServerConnection, McpServers, OutsideTool } from '../../src/core/mcp-out/ports.js';
import type { StatementDoor, ToolMarks } from '../../src/core/mcp-out/state-party.js';
import type { Statement } from '../../src/core/mcp-out/statement.js';
import { err, ok } from '../../src/core/shared/result.js';

/** Two tools of a CRM, as its tools/list answers them. */
export const CRM_TOOLS: OutsideTool[] = [
  { name: 'list_contacts', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'create_deal', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, idempotentHint: false } },
];

/** An outside MCP server that lists its tools while reachable; it records each connection it was listed with. */
export function fakeMcpServers(tools: OutsideTool[] = CRM_TOOLS) {
  const state = { isReachable: true };
  const listedWith: McpServerConnection[] = [];
  const servers: McpServers & { state: typeof state; listedWith: McpServerConnection[] } = {
    state,
    listedWith,
    listTools: (connection) => {
      listedWith.push(connection);
      return Promise.resolve(state.isReachable ? ok(tools) : err({ kind: 'unreachable' as const, reason: 'connect ECONNREFUSED' }));
    },
    callTool: () => Promise.reject(new Error('not used by stating')),
  };
  return servers;
}

/** The fleet's setStatement, as a proxy ship's crew calls it: it keeps each statement, or refuses with the refusal set. */
export function fakeStatementDoor() {
  const state: { refusal: FleetRefusal | undefined } = { refusal: undefined };
  const stated: { crewToken: string; statement: Statement }[] = [];
  const door: StatementDoor & { state: typeof state; stated: typeof stated } = {
    state,
    stated,
    setStatement: (crewToken, statement) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      stated.push({ crewToken, statement });
      return Promise.resolve(ok(undefined));
    },
  };
  return door;
}

/** argo's repeatable marks in memory, by fleet, party and tool. */
export function memoryToolMarks(): ToolMarks & { held: Set<string> } {
  const held = new Set<string>();
  const key = (fleetId: FleetId, party: string, tool: string) => JSON.stringify([fleetId, party, tool]);
  return {
    held,
    repeatable: (fleetId, party) =>
      Promise.resolve(
        new Set(
          [...held].flatMap((each) => {
            const [heldFleet, heldParty, tool] = JSON.parse(each) as [string, string, string];
            return heldFleet === fleetId && heldParty === party ? [tool] : [];
          }),
        ),
      ),
    mark: (fleetId, { party, tool, isRepeatable }) => {
      if (isRepeatable) {
        held.add(key(fleetId, party, tool));
      } else {
        held.delete(key(fleetId, party, tool));
      }
      return Promise.resolve();
    },
  };
}
