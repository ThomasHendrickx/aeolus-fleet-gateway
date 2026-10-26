/**
 * Which tools of an outside MCP server the fleet may call (aeolus-fleet#1151).
 * An approver switches each tool on or off per party, so every ship that may
 * reach the party reaches the same tools. A tool with no switch is one the
 * server listed after its switches were kept: it is off, and new, until an
 * approver switches it. A party with no switches kept yet (approved before
 * tools were switched, or through a request with no tool choice) has every
 * tool on; its next statement keeps every tool it lists on.
 */
import type { OutsideTool } from '../mcp-out/ports.js';

/** Each known tool's switch, by name: on or off. */
export type ToolSwitches = ReadonlyMap<string, boolean>;

/** The error a call to a tool not switched on is answered, and nothing reaches the server. */
export const TOOL_NOT_ENABLED = 'tool not enabled for this party';

/** A tool as an approver sees it: its switch, and whether it is new, with no switch yet. */
export interface SwitchedTool {
  name: string;
  description?: string;
  /** Whether the server says the tool changes nothing, its readOnlyHint as it gives it: a hint, never trusted on its own; none when it says nothing. */
  isReadOnly?: boolean;
  /** Whether the server says the tool may destroy what it changes, its destructiveHint as it gives it; none when it says nothing. */
  isDestructive?: boolean;
  isOn: boolean;
  isNew: boolean;
}

/** Whether the fleet may call the tool: switched on, or every tool while no switches are kept. */
export function isToolOn(switches: ToolSwitches | null, tool: string): boolean {
  return switches === null || switches.get(tool) === true;
}

/** The tools the server lists now, each with its switch. */
export function switchedToolsOf(listed: readonly OutsideTool[], switches: ToolSwitches | null): SwitchedTool[] {
  return listed.map(({ name, description, annotations }) => ({
    name,
    ...(description === undefined ? {} : { description }),
    ...(annotations?.readOnlyHint === undefined ? {} : { isReadOnly: annotations.readOnlyHint }),
    ...(annotations?.destructiveHint === undefined ? {} : { isDestructive: annotations.destructiveHint }),
    isOn: isToolOn(switches, name),
    isNew: switches !== null && !switches.has(name),
  }));
}
