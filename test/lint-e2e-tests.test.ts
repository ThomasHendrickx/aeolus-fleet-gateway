import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// End-to-end and browser tests wait on what the app does, never on a sleep, `networkidle` or a raw locator.

// The files linted here do not exist, so type information is off; these restrictions need none.
const eslint = new ESLint({ overrideConfig: [tseslint.configs.disableTypeChecked, { languageOptions: { parserOptions: { projectService: false } } }] });

const inE2eTests = [
  'test/rules-probe.browser.test.ts',
  'web/app/rules-probe.browser.test.tsx',
  'test/rules-probe.e2e.test.ts',
  'test/start.integration.test.ts',
  'test/parties-pages.integration.test.ts',
  'test/slack-pages.integration.test.ts',
];

/** The count of restriction messages for the statement linted as if it lived at `filePath`. */
async function restrictions(filePath: string, statement: string): Promise<number> {
  const source = `export async function probe(page: { locator(selector: string): unknown; waitForTimeout(ms: number): Promise<void>; waitForLoadState(state: string): Promise<void>; getByTestId(id: string): unknown }) {\n  ${statement}\n}\n`;
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter(({ ruleId }) => ruleId === 'no-restricted-syntax' || ruleId === 'no-restricted-imports').length;
}

describe('fixed sleeps in end-to-end tests', () => {
  it.each([
    { label: 'waitForTimeout', statement: 'await page.waitForTimeout(500);' },
    { label: 'a promise around setTimeout', statement: 'await new Promise((resolve) => setTimeout(resolve, 500));' },
    { label: 'a promise around globalThis.setTimeout', statement: 'await new Promise((resolve) => globalThis.setTimeout(resolve, 500));' },
    { label: 'a promise around window.setTimeout', statement: 'await new Promise((resolve) => window.setTimeout(resolve, 500));' },
  ])('refuses $label', async ({ statement }) => {
    for (const path of inE2eTests) expect({ path, isRefused: (await restrictions(path, statement)) > 0 }).toEqual({ path, isRefused: true });
  });

  it.each(['timers/promises', 'node:timers/promises'])('refuses importing %s', async (module) => {
    for (const path of inE2eTests) {
      const [result] = await eslint.lintText(`import { setTimeout } from '${module}';\nexport const sleep = setTimeout;\n`, { filePath: path });
      expect({ path, isRefused: (result?.messages ?? []).some(({ ruleId }) => ruleId === 'no-restricted-imports') }).toEqual({ path, isRefused: true });
    }
  });
});

describe('networkidle in end-to-end tests', () => {
  it('refuses waiting for networkidle', async () => {
    for (const path of inE2eTests) expect({ path, isRefused: (await restrictions(path, "await page.waitForLoadState('networkidle');")) > 0 }).toEqual({ path, isRefused: true });
  });

  it('allows waiting for another load state', async () => {
    expect(await restrictions(inE2eTests[0] ?? '', "await page.waitForLoadState('load');")).toBe(0);
  });
});

describe('raw locators in end-to-end tests', () => {
  it.each([
    { label: 'a CSS locator', statement: "page.locator('.notice');" },
    { label: 'a test id attribute locator', statement: "page.locator('[data-testid=submit]');" },
    { label: 'a test id attribute selector in a template', statement: 'const selector = `[data-testid=${"submit"}]`;' },
  ])('refuses $label', async ({ statement }) => {
    for (const path of inE2eTests) expect({ path, isRefused: (await restrictions(path, statement)) > 0 }).toEqual({ path, isRefused: true });
  });

  it('allows the test id getter', async () => {
    expect(await restrictions(inE2eTests[0] ?? '', "page.getByTestId('submit');")).toBe(0);
  });
});

describe('outside end-to-end tests', () => {
  it('leaves other tests alone', async () => {
    expect(await restrictions('src/core/rules-probe.test.ts', 'await page.waitForTimeout(500);')).toBe(0);
  });
});
