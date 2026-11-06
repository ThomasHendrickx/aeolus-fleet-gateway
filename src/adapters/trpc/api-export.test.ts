import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsc = join(root, 'node_modules/typescript/bin/tsc');

/**
 * A consumer beside the gateway as npm installs it: the package's package.json
 * and the declarations the build writes, under node_modules/@aeolus-fleet/gateway.
 * It sits inside this repo's node_modules, so the declarations resolve
 * @trpc/server, zod and @aeolus-fleet/common as an installed package would.
 */
let consumer: string;

beforeAll(() => {
  consumer = mkdtempSync(join(root, 'node_modules/.api-export-'));
  const installed = join(consumer, 'node_modules/@aeolus-fleet/gateway');
  mkdirSync(installed, { recursive: true });
  copyFileSync(join(root, 'package.json'), join(installed, 'package.json'));
  execFileSync(process.execPath, [tsc, '--project', join(root, 'tsconfig.build.json'), '--emitDeclarationOnly', '--outDir', join(installed, 'dist')]);
}, 120_000);

afterAll(() => {
  rmSync(consumer, { recursive: true, force: true });
});

/** The consumer's own project: strict NodeNext, without this repo's source condition. */
const consumerProject = {
  compilerOptions: { noEmit: true, strict: true, module: 'nodenext', moduleResolution: 'nodenext', target: 'es2024', skipLibCheck: true, types: ['node'] },
  files: ['consumer.ts'],
};

/** Typechecks a consumer's file: tsc's output, empty when it passes. */
function typecheck(source: string): string {
  writeFileSync(join(consumer, 'consumer.ts'), source);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(consumerProject));
  try {
    execFileSync(process.execPath, [tsc, '--project', join(consumer, 'tsconfig.json')], { encoding: 'utf8' });
    return '';
  } catch (error) {
    // execFileSync's error carries tsc's output when tsc exits non-zero.
    return error instanceof Error && 'stdout' in error ? String(error.stdout) : String(error);
  }
}

const client = `import { createTRPCClient, httpLink } from '@trpc/client';
import type { GatewayRouter } from '@aeolus-fleet/gateway/api';

const api = createTRPCClient<GatewayRouter>({ links: [httpLink({ url: 'https://gateway.example/trpc' })] });
`;

describe("the gateway's API router type, at @aeolus-fleet/gateway/api", () => {
  it("types a consumer's client with a type-only import", () => {
    expect(typecheck(`${client}export const status = api.connection.status;\n`)).toBe('');
  }, 60_000);

  it('fails a consumer that calls a procedure the router does not have', () => {
    expect(typecheck(`${client}export const missing = api.connection.noSuchProcedure;\n`)).toMatch(/error TS2339: Property 'noSuchProcedure' does not exist/);
  }, 60_000);
});
