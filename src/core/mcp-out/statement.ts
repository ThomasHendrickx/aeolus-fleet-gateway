/**
 * A proxy ship's statement (decision 0047), written from its outside MCP
 * server's `tools/list`: each tool is one capability, with MCP's fields as
 * the server states them (decision 0048), the content types that call it
 * and carry its result, and argo's repeatable mark (interop 5.2).
 */
import { toolInputType, toolResultType } from './content-types.js';
import type { OutsideTool, ToolAnnotations } from './ports.js';

export interface Capability {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly inputModes: readonly string[];
  readonly outputModes: readonly string[];
  readonly annotations?: ToolAnnotations;
  /** argo's mark that a call may be handed again when it died unanswered; the server's hints never set it. */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the statement's own field, kept as the fleet names it.
  readonly repeatable?: true;
}

export interface Statement {
  readonly summary: string;
  readonly capabilities: readonly Capability[];
}

function capabilityOf(tool: OutsideTool, isRepeatable: boolean): Capability {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    inputModes: [toolInputType(tool.name)],
    outputModes: [toolResultType(tool.name)],
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    ...(isRepeatable ? { repeatable: true as const } : {}),
  };
}

/**
 * The statement of a party's proxy ship. Its summary names the party only:
 * the server's URL and credential stay in the gateway (NAT both ways).
 */
export function statementOf(input: { partyName: string; tools: readonly OutsideTool[]; repeatable: ReadonlySet<string> }): Statement {
  return {
    summary: `${input.partyName}, an outside MCP server reached through the Aeolus gateway. Each capability is one of its tools: send its input type with the tool arguments as a JSON object, and the reply carries the tool result.`,
    capabilities: input.tools.map((tool) => capabilityOf(tool, input.repeatable.has(tool.name))),
  };
}
