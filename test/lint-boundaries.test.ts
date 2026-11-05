import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// The files linted here do not exist, so type information is off; the boundaries need none.
const eslint = new ESLint({ overrideConfig: [tseslint.configs.disableTypeChecked, { languageOptions: { parserOptions: { projectService: false } } }] });

/** The messages of the import boundaries for source text linted as if it lived at `filePath`. */
async function boundaryMessages(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports' || message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message);
}

describe('Bridge boundary', () => {
  it('lets Bridge import the gateway person API client', async () => {
    const messages = await boundaryMessages('bridge/example.ts', "import { personApi } from '../web/lib/gateway-api/gateway-api.js';\nexport const api = personApi;\n");
    expect(messages).toEqual([]);
  });

  it('refuses Bridge importing the core', async () => {
    const messages = await boundaryMessages('bridge/example.ts', "import { type ReadInbox } from '../src/core/people/read-inbox.js';\nexport type Read = ReadInbox;\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Bridge');
  });

  it('refuses Bridge importing an adapter, dynamically too', async () => {
    const messages = await boundaryMessages('bridge/example.ts', "export const load = () => import('../src/adapters/fleet/fleet-client.js');\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Bridge');
  });

  it('refuses Bridge importing the fleet package', async () => {
    const messages = await boundaryMessages('bridge/example.ts', "import { createCoreClient } from '@aeolus-fleet/core';\nexport const client = createCoreClient;\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Bridge');
  });

  it('refuses the MCP side importing Bridge', async () => {
    const messages = await boundaryMessages('src/adapters/mcp/example.ts', "import { x } from '../../../bridge/example.js';\nexport const y = x;\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('MCP');
  });

  it('refuses the person tools importing Bridge', async () => {
    const messages = await boundaryMessages('src/adapters/http/person-tools.ts', "export const load = () => import('../../../bridge/example.js');\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('MCP');
  });

  it('lets the rest of the gateway keep its imports', async () => {
    const messages = await boundaryMessages('src/adapters/http/example.ts', "import { type ReadInbox } from '../../core/people/read-inbox.js';\nexport type Read = ReadInbox;\n");
    expect(messages).toEqual([]);
  });

  it('keeps the core import rules in the MCP core', async () => {
    const messages = await boundaryMessages('src/core/mcp-in/example.ts', "import { PrismaClient } from '@prisma/client';\nexport const client = PrismaClient;\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('src/core');
  });

  it('keeps the core purity rules in the MCP core', async () => {
    const messages = await boundaryMessages('src/core/mcp-out/example.ts', 'export const at = new Date();\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('clock');
  });

  it('keeps Prisma in its adapter in the MCP adapter', async () => {
    const messages = await boundaryMessages('src/adapters/mcp/example.ts', "import { PrismaClient } from '@prisma/client';\nexport const client = PrismaClient;\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('prisma adapter');
  });
});
