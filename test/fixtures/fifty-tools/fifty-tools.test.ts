import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpServers } from '../../../src/adapters/mcp/mcp-servers.js';
import { startFiftyTools, type FiftyTools } from './fifty-tools.js';

let server: FiftyTools;
const servers = createMcpServers();

beforeAll(async () => {
  server = await startFiftyTools();
});

afterAll(async () => {
  await server.close();
});

describe('the 50-tool test server (gateway scopes 4.3)', () => {
  it('lists 50 tools: 31 the server says read only, 14 it says change or destroy, and 5 with no hint', async () => {
    const listed = await servers.listTools({ url: server.url, credential: { kind: 'none' } });

    const tools = listed.isOk ? listed.value : [];
    expect({
      count: tools.length,
      readOnly: tools.filter(({ annotations }) => annotations?.readOnlyHint === true).length,
      changing: tools.filter(({ annotations }) => annotations?.readOnlyHint === false || annotations?.destructiveHint === true).length,
      withoutHints: tools.filter(({ annotations }) => annotations === undefined).length,
    }).toEqual({ count: 50, readOnly: 31, changing: 14, withoutHints: 5 });
  });

  it('answers each tool by its own name', async () => {
    const outcome = await servers.callTool({ url: server.url, credential: { kind: 'none' } }, { name: 'delete_lead', arguments: {}, timeoutMs: 5_000 });

    expect(outcome).toMatchObject({ kind: 'answered', result: { content: [{ type: 'text', text: 'delete_lead' }] } });
  });
});
