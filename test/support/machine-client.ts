/**
 * A machine client: an outside MCP client with no human at the authorize
 * step, as a vendor agent such as AgentCore is (vendor platforms V4). It
 * finds the authorization server from the 401's protected resource
 * metadata, takes a token with OAuth client credentials
 * (`client_secret_basic`, `resource` the MCP endpoint), and calls tools at
 * the MCP endpoint, as the MCP TypeScript SDK runs one.
 */
import { Client, ClientCredentialsProvider, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export interface MachineCredentials {
  clientId: string;
  clientSecret: string;
}

/** A machine client connected to the MCP endpoint at `mcpUrl`, signed in with its client credentials. */
export async function aMachineClient(mcpUrl: string, credentials: MachineCredentials): Promise<Client> {
  const mcp = new Client({ name: 'machine-client', version: '1' });
  const authProvider = new ClientCredentialsProvider({ ...credentials, expectedIssuer: new URL(mcpUrl).origin });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider }));
  return mcp;
}
