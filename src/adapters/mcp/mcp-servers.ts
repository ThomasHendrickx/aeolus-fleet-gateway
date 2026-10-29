/**
 * The outside MCP servers, over Streamable HTTP with the official SDK. One
 * connection per listing or call, as MCP 2026-07-28 keeps no session. A
 * failure reads as where it happened: before the call left the gateway
 * (notSent, nothing ran) or after (unanswered, it may have run), so the core
 * decides whether it may hand the call again (interop 5.2).
 */
import {
  Client,
  ClientCredentialsProvider,
  InsufficientScopeError,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import { z } from 'zod';

import type { CredentialRefusal, McpServerConnection, McpServers, OutsideTool, ToolCall, ToolCallOutcome, ToolResult } from '../../core/mcp-out/ports.js';
import { err, ok } from '../../core/shared/result.js';

/** How the gateway names itself to outside MCP servers. */
const CLIENT_INFO = { name: 'aeolus-gateway', version: '1' };

/** HTTP statuses that refuse the gateway's credential: the server ran nothing. */
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

const jsonObject = z.record(z.string(), z.unknown());

const toolAnnotations = z.object({
  title: z.string().optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

const listedTool = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: jsonObject,
  outputSchema: jsonObject.optional(),
  annotations: toolAnnotations.optional(),
});

const callResult = z.object({
  content: z.array(z.unknown()).default([]),
  structuredContent: jsonObject.optional(),
  isError: z.boolean().optional(),
});

function transportFor(connection: McpServerConnection): StreamableHTTPClientTransport {
  const url = new URL(connection.url);
  const { credential } = connection;
  switch (credential.kind) {
    case 'none':
      return new StreamableHTTPClientTransport(url);
    case 'bearer':
      return new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${credential.token}` } } });
    case 'clientCredentials':
      return new StreamableHTTPClientTransport(url, {
        authProvider: new ClientCredentialsProvider({
          clientId: credential.clientId,
          clientSecret: credential.clientSecret,
          expectedIssuer: credential.issuer,
          ...(credential.scope === undefined ? {} : { scope: credential.scope }),
        }),
      });
    case 'personSignIn':
      // Each person's own grant goes with the call; the party's client alone signs nobody in, so the server refuses the call unsent.
      return new StreamableHTTPClientTransport(url);
  }
}

async function connected(connection: McpServerConnection): Promise<Client> {
  const client = new Client(CLIENT_INFO, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transportFor(connection));
  return client;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The server refused the gateway's credential, or could not be reached: the request did not run. */
function isNotSent(error: unknown): boolean {
  if (error instanceof UnauthorizedError || error instanceof InsufficientScopeError) {
    return true;
  }
  if (error instanceof SdkHttpError) {
    return error.status === HTTP_UNAUTHORIZED || error.status === HTTP_FORBIDDEN;
  }
  if (error instanceof SdkError) {
    return error.code === SdkErrorCode.SendFailed && isConnectionRefused(error.cause);
  }
  return error instanceof TypeError && isConnectionRefused(error.cause);
}

/** How the server refused the credential, where it did. */
function refusalOf(error: unknown): CredentialRefusal | undefined {
  if (error instanceof InsufficientScopeError) {
    return 'insufficientScope';
  }
  if (error instanceof UnauthorizedError || (error instanceof SdkHttpError && error.status === HTTP_UNAUTHORIZED)) {
    return 'unauthorized';
  }
  return undefined;
}

/** A call the gateway never sent, saying how the server refused its credential where it did. */
function notSentOf(error: unknown): ToolCallOutcome {
  const refusal = refusalOf(error);
  return { kind: 'notSent', reason: reasonOf(error), ...(refusal === undefined ? {} : { refusal }) };
}

const systemError = z.object({ code: z.string() });

/** No connection was made, so nothing was sent. */
function isConnectionRefused(cause: unknown): boolean {
  const failure = systemError.safeParse(cause);
  return failure.success && ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(failure.data.code);
}

/** A JSON-RPC error the server answered with: an answer, so the call is over, and it ran nothing. */
function protocolErrorResult(error: ProtocolError): ToolResult {
  return { content: [{ type: 'text', text: `MCP error ${String(error.code)}: ${error.message}` }], isError: true };
}

function toolOf(tool: z.infer<typeof listedTool>): OutsideTool {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  };
}

async function listEveryTool(client: Client): Promise<OutsideTool[]> {
  const tools: OutsideTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? {} : { cursor });
    tools.push(...page.tools.map((tool) => toolOf(listedTool.parse(tool))));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}

async function callOnce(client: Client, call: ToolCall): Promise<ToolCallOutcome> {
  const answer = callResult.parse(await client.callTool({ name: call.name, arguments: { ...call.arguments } }, { timeout: call.timeoutMs }));
  return {
    kind: 'answered',
    result: {
      content: answer.content,
      ...(answer.structuredContent === undefined ? {} : { structuredContent: answer.structuredContent }),
      isError: answer.isError ?? false,
    },
  };
}

export function createMcpServers(): McpServers {
  return {
    async listTools(connection) {
      let client: Client | undefined;
      try {
        client = await connected(connection);
        return ok(await listEveryTool(client));
      } catch (error) {
        return err({ kind: 'unreachable', reason: reasonOf(error) });
      } finally {
        await client?.close();
      }
    },

    async callTool(connection, call) {
      let client: Client;
      try {
        client = await connected(connection);
      } catch (error) {
        return notSentOf(error);
      }
      try {
        return await callOnce(client, call);
      } catch (error) {
        if (error instanceof ProtocolError) {
          return { kind: 'answered', result: protocolErrorResult(error) };
        }
        return isNotSent(error) ? notSentOf(error) : { kind: 'unanswered', reason: reasonOf(error) };
      } finally {
        await client.close();
      }
    },
  };
}
