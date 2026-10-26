/**
 * A proxy ship's statement (decision 0047), written from its outside MCP
 * server's `tools/list`: each tool is one capability, with MCP's fields as
 * the server states them (decision 0048), the content types that call it
 * and carry its result, argo's repeatable mark (interop 5.2), the
 * gateway's own wait and deadline for a call (interop 3.4, 5.3), and the
 * scopes a calling ship needs (gateway scopes P1).
 */
import { scopesNeeded, type ScopeRequirements } from '../parties/scope-requirements.js';
import { toolInputType, toolResultType } from './content-types.js';
import type { OutsideTool, ToolAnnotations } from './ports.js';

export interface Capability {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  /** The JSON Schema of its input: an MCP tool states one, an A2A skill none. */
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly inputModes: readonly string[];
  readonly outputModes: readonly string[];
  readonly annotations?: ToolAnnotations;
  /** How long a caller waits for the answer before it is answered a handle or task (interop 5.3). */
  readonly waitMs: number;
  /** How long a call may take before it fails: when the gateway gives up on the server (interop 3.4). */
  readonly deadlineMs: number;
  /** argo's mark that a call may be handed again when it died unanswered; the server's hints never set it. */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the statement's own field, kept as the fleet names it.
  readonly repeatable?: true;
  /** The scopes a calling ship must hold, every one, so it sees them before it calls (gateway scopes P1); none when it needs none. */
  readonly scopes?: readonly string[];
}

export interface Statement {
  readonly summary: string;
  readonly capabilities: readonly Capability[];
}

/** The gateway's own timing for a call to an outside server: how long a caller waits, and when the call fails. */
export interface CallTiming {
  readonly waitMs: number;
  readonly deadlineMs: number;
}

/** The scopes field of a capability: stated only when a calling ship needs any. */
export function scopesFieldOf(scopes: readonly string[]): { scopes?: readonly string[] } {
  return scopes.length === 0 ? {} : { scopes };
}

function capabilityOf(tool: OutsideTool, marked: { isRepeatable: boolean; timing: CallTiming; scopes: readonly string[] }): Capability {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    inputModes: [toolInputType(tool.name)],
    outputModes: [toolResultType(tool.name)],
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    ...(marked.isRepeatable ? { repeatable: true as const } : {}),
    waitMs: marked.timing.waitMs,
    deadlineMs: marked.timing.deadlineMs,
    ...scopesFieldOf(marked.scopes),
  };
}

/**
 * The statement of a party's proxy ship. Its summary names the party only:
 * the server's URL and credential stay in the gateway (NAT both ways).
 */
export function statementOf(input: { partyName: string; tools: readonly OutsideTool[]; repeatable: ReadonlySet<string>; timing: CallTiming; requirements: ScopeRequirements }): Statement {
  return {
    summary: `${input.partyName}, an outside MCP server reached through the Aeolus gateway. Each capability is one of its tools: send its input type with the tool arguments as a JSON object, and the reply carries the tool result.`,
    capabilities: input.tools.map((tool) => capabilityOf(tool, { isRepeatable: input.repeatable.has(tool.name), timing: input.timing, scopes: scopesNeeded(input.requirements, tool.name) })),
  };
}
