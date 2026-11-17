/** Set by the gateway's server as it starts the web app (src/adapters/web/next-web-app.ts): its public URL's MCP endpoint. */
const MCP_URL_VARIABLE = 'AEOLUS_GATEWAY_MCP_URL';

/** Where outside MCP clients connect to the gateway, as Copy MCP address copies it. */
export function mcpAddress(): string {
  const url = process.env[MCP_URL_VARIABLE];
  if (url === undefined) {
    throw new Error(`${MCP_URL_VARIABLE} is not set: the gateway's server starts the web app`);
  }
  return url;
}
