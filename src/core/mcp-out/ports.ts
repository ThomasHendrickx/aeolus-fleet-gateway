/**
 * The outside MCP server behind an app proxy ship, as MCP out sees it
 * (interop 3.3, 5.2): its tools, and one call at a time.
 */
import type { Result } from '../shared/result.js';
import type { McpServerCredential } from '../vault/credential.js';

/** Where an outside MCP server is, and how the gateway signs in to it. */
export interface McpServerConnection {
  /** Its Streamable HTTP endpoint. */
  readonly url: string;
  readonly credential: McpServerCredential;
}

/** MCP's tool annotations (2026-07-28), as the server states them: hints, never trusted on their own. */
/* eslint-disable @typescript-eslint/naming-convention -- MCP's own field names, kept as the protocol names them. */
export interface ToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}
/* eslint-enable @typescript-eslint/naming-convention */

/** One tool of an outside MCP server, as its `tools/list` answers it. */
export interface OutsideTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly annotations?: ToolAnnotations;
}

/** A tool's answer: its result, an error result included (`isError`). */
export interface ToolResult {
  readonly content: readonly unknown[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError: boolean;
}

/**
 * How one `tools/call` ended (5.2):
 * - answered: the server's answer, which confirms the hand-over;
 * - notSent: the gateway never sent it (the server was unreachable, or refused the gateway's credential), so it did not run;
 * - unanswered: sent, and no answer came (a broken stream, a timeout): whether the server ran it is unknown.
 */
export type ToolCallOutcome =
  | { readonly kind: 'answered'; readonly result: ToolResult }
  | { readonly kind: 'notSent'; readonly reason: string }
  | { readonly kind: 'unanswered'; readonly reason: string };

export interface ToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /** How long the gateway waits for the answer before it counts the call as unanswered. */
  readonly timeoutMs: number;
}

/** The outside MCP servers the gateway calls. */
export interface McpServers {
  /** The server's tools, every page of them; unreachable when it cannot be listed. */
  listTools(connection: McpServerConnection): Promise<Result<readonly OutsideTool[], { readonly kind: 'unreachable'; readonly reason: string }>>;
  callTool(connection: McpServerConnection, call: ToolCall): Promise<ToolCallOutcome>;
}
