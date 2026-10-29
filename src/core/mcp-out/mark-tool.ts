import type { FleetId } from '@aeolus-fleet/common';

import type { PartyStore } from '../parties/ports.js';
import { refuse } from '../shared/errors.js';
import type { StateParty, ToolMarks } from './state-party.js';

export type MarkTool = (input: { fleetId: FleetId; name: string; tool: string; isRepeatable: boolean }) => ReturnType<StateParty>;

/**
 * Use case: argo marks a party's tool repeatable, or takes the mark off
 * (interop 5.2): a call to it that died unanswered may then be handed
 * again. The mark is kept first and stated at once; while the statement
 * cannot be made, the mark waits for the next.
 */
export function createMarkTool(deps: { parties: PartyStore; marks: ToolMarks; stateParty: StateParty }): MarkTool {
  return async ({ fleetId, name, tool, isRepeatable }) => {
    if (!(await deps.parties.find(fleetId, name))) {
      return refuse('NO_SUCH_PARTY', `No party named ${name}`);
    }
    await deps.marks.mark(fleetId, { party: name, tool, isRepeatable });
    return deps.stateParty({ fleetId, name });
  };
}
