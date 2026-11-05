import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BRIDGE_PAGE_TITLE, GATEWAY_PAGE_TITLE } from './page-title';

const appDir = join(import.meta.dirname, '..', 'app');
const SETS_TITLE = /export (const metadata|(async )?function generateMetadata)/;

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the page titles', () => {
  it('are <Surface> · Aeolus', () => {
    expect(GATEWAY_PAGE_TITLE).toBe('Gateway · Aeolus');
    expect(BRIDGE_PAGE_TITLE).toBe('Bridge · Aeolus');
  });

  it('are set by the Gateway root layout and the Bridge layout', () => {
    expect(readFileSync(join(appDir, 'layout.tsx'), 'utf8')).toMatch(/title: GATEWAY_PAGE_TITLE/);
    expect(readFileSync(join(appDir, '(bridge)', 'layout.tsx'), 'utf8')).toMatch(/title: BRIDGE_PAGE_TITLE/);
  });

  it('are set by those two layouts only, so no page replaces its surface title', () => {
    const setting = sourcesUnder(appDir)
      .filter((path) => SETS_TITLE.test(readFileSync(path, 'utf8')))
      .map((path) => relative(appDir, path))
      .sort();
    expect(setting).toEqual(['(bridge)/layout.tsx', 'layout.tsx']);
  });
});
