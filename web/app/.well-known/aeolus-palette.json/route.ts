import { mcpAddress } from '../../../../bridge/palette/hooks/mcp-address';
import { gatewayPaletteListOf } from '../../../../bridge/palette/services/palette-list';

// Read per request: the MCP address is the running server's setting.
export const dynamic = 'force-dynamic';

/** The gateway's palette list, with no sign-in, for the other Aeolus apps' servers (header design H4). */
export function GET(): Response {
  return Response.json(gatewayPaletteListOf({ mcpAddress: mcpAddress() }));
}
