// @ts-check
import js from '@eslint/js';
import checkFile from 'eslint-plugin-check-file';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/*
 * The guardrails aeolus-fleet enforces, kept for the gateway: what CLAUDE.md
 * and the skills ask for, enforced here so it never depends on an agent
 * remembering.
 *
 * Several guardrails use the same ESLint rule (no-restricted-imports and its
 * siblings) on overlapping files, and ESLint keeps only the last options it
 * finds for a rule. So the restrictions are lists, and every block below
 * passes the complete set for its files.
 */

/** @typedef {{ regex: string, message: string }} ImportRestriction */
/** @typedef {{ selector: string, message: string }} SyntaxRestriction */
/** @typedef {{ object: string, property: string, message: string }} PropertyRestriction */

/** @type {ImportRestriction[]} */
const prismaOutsideItsAdapter = [
  { regex: '^@prisma/', message: '@prisma/* is imported only in the prisma adapter.' },
  { regex: '^pg([-/].+)?$', message: 'pg is imported only in the prisma adapter.' },
];

/**
 * What src/core must never import (CLAUDE.md, "Architecture rules").
 * It includes Prisma and pg, so the core needs no other list for them.
 * @type {ImportRestriction[]}
 */
const coreForbiddenImports = [
  { what: 'Prisma', regex: '^(prisma|prisma/.+|@prisma/.+|\\.prisma/.+)$' },
  { what: 'pg', regex: '^pg([-/].+)?$' },
  { what: 'Fastify', regex: '^(fastify|fastify/.+|fastify-.+|@fastify/.+)$' },
  { what: 'tRPC', regex: '^@trpc/.+$' },
  { what: 'the MCP SDK', regex: '^@modelcontextprotocol/.+$' },
  { what: 'an adapter', regex: '(^|/)adapters(/|$)' },
].map(({ what, regex }) => ({
  regex,
  message: `src/core must not import ${what}. The core holds domain, use cases and ports; adapters depend on it, never the other way round.`,
}));

const clockMessage = 'src/core never reads the clock: take `now` from the Clock port or as input.';
const cryptoMessage = 'src/core never uses crypto: hashing and random tokens are ports.';

/** The core is deterministic and never throws (domain-modelling and typescript skills). */
const coreImpure = {
  /** @type {ImportRestriction[]} */
  imports: [{ regex: '^(node:)?crypto$', message: cryptoMessage }],
  /** @type {SyntaxRestriction[]} */
  syntax: [
    { selector: 'NewExpression[callee.name="Date"][arguments.length=0]', message: clockMessage },
    { selector: 'CallExpression[callee.name="Date"]', message: clockMessage },
    {
      selector: 'ThrowStatement',
      message: 'src/core never throws: return a Result with a domain error kind. Only adapters throw, for system failures.',
    },
  ],
  /** @type {PropertyRestriction[]} */
  properties: [
    { object: 'Date', property: 'now', message: clockMessage },
    { object: 'Math', property: 'random', message: 'src/core never makes randomness: use an id or token port.' },
    { object: 'globalThis', property: 'crypto', message: cryptoMessage },
  ],
  globals: [{ name: 'crypto', message: cryptoMessage }],
};

/** @type {PropertyRestriction[]} */
const noModuleMocks = ['mock', 'doMock'].map((property) => ({
  object: 'vi',
  property,
  message: 'No module mocks: hand-write an in-memory fake of the port and assert outcomes (test-driven-development skill).',
}));

/**
 * The core is tested with hand-written in-memory fakes, asserting outcomes
 * and stored state, not calls. Adapters (CLI, I/O) may use them.
 * @type {PropertyRestriction[]}
 */
const noTestDoubles = ['fn', 'spyOn'].map((property) => ({
  object: 'vi',
  property,
  message:
    'No vi.fn or vi.spyOn in src/core: hand-write an in-memory fake and assert outcomes and stored state, not calls (test-driven-development skill).',
}));

// esquery regex literals cannot contain a slash, so write it as \x2F.
const esqueryRegex = (/** @type {string} */ regex) => `/${regex.replaceAll('/', '\\x2F')}/`;

/**
 * no-restricted-imports does not see import() expressions or import('x') types,
 * so each import restriction is also a syntax restriction.
 * @param {ImportRestriction[]} restrictions
 * @returns {SyntaxRestriction[]}
 */
function dynamicImports(restrictions) {
  return restrictions.flatMap(({ regex, message }) => [
    { selector: `ImportExpression[source.value=${esqueryRegex(regex)}]`, message },
    { selector: `TSImportType[source.value=${esqueryRegex(regex)}]`, message },
  ]);
}

/**
 * Every import restriction for a set of files, static and dynamic, plus any
 * other syntax restriction for the same files.
 * @param {{ patterns: ImportRestriction[], syntax?: SyntaxRestriction[] }} restrictions
 */
function importRules({ patterns, syntax = [] }) {
  return {
    'no-restricted-imports': ['error', { patterns: patterns.map(({ regex, message }) => ({ regex, caseSensitive: true, message })) }],
    'no-restricted-syntax': ['error', ...dynamicImports(patterns), ...syntax],
  };
}

/**
 * What Bridge (the top-level bridge/ folder) must never import: it reaches the
 * person ship only through the gateway's person API (web/lib/gateway-api), so
 * not the core, an adapter or the fleet's own package.
 * @type {ImportRestriction[]}
 */
const bridgeForbiddenImports = [
  { regex: '(^|/)src(/|$)', what: 'the gateway source (src/core and src/adapters)' },
  { regex: '^@aeolus-fleet/core(/.+)?$', what: 'the fleet package' },
].map(({ what, regex }) => ({
  regex,
  message: `Bridge must not import ${what}: it reaches the person ship only through the gateway's person API (web/lib/gateway-api).`,
}));

/** The gateway's MCP side, which serves MCP clients and never imports Bridge. */
const mcpSideAdapterFiles = ['src/adapters/mcp/**/*.ts', 'src/adapters/http/{mcp-endpoint,mcp-task,person-tools}*.ts'];
const mcpSideCoreFiles = ['src/core/{mcp-in,mcp-out}/**/*.ts'];

/** @type {ImportRestriction[]} */
const mcpSideForbiddenImports = [
  {
    regex: '^(\\.\\./)+bridge(/|$)',
    message: 'The gateway\'s MCP side must not import Bridge: Bridge is one client of the person API, beside the MCP doors.',
  },
];

/**
 * End-to-end and browser tests wait on what the app does (a retrying assertion, a known response or
 * the part's data-state), never on time, and find parts by test id, role or text.
 * The runner is vitest's browser mode, which eslint-plugin-playwright does not cover (it reads
 * @playwright/test), so these are no-restricted-syntax selectors.
 */
const e2eTestFiles = ['**/*.browser.test.{ts,tsx}', '**/*.e2e.test.{ts,tsx}', 'test/{start,parties-pages,slack-pages}.integration.test.ts'];
const sleepMessage = "No fixed sleep in an end-to-end test: wait with a retrying assertion (expect.poll, expect.element), a known response or the part's data-state.";
const rawLocatorMessage = 'No raw locator in an end-to-end test: use getByTestId, getByRole or getByText.';

/** @type {SyntaxRestriction[]} */
const e2eSyntax = [
  { selector: 'CallExpression[callee.property.name="waitForTimeout"]', message: sleepMessage },
  { selector: 'NewExpression[callee.name="Promise"] CallExpression:matches([callee.name="setTimeout"], [callee.property.name="setTimeout"])', message: sleepMessage },
  { selector: 'Literal[value="networkidle"]', message: "No networkidle in an end-to-end test: wait on a known response or the part's data-state." },
  { selector: 'CallExpression[callee.property.name="locator"]', message: rawLocatorMessage },
  { selector: 'Literal[value=/\\[data-testid/]', message: rawLocatorMessage },
  { selector: 'TemplateElement[value.raw=/\\[data-testid/]', message: rawLocatorMessage },
];

/** @type {ImportRestriction[]} */
const sleepImports = [{ regex: '^(node:)?timers/promises$', message: sleepMessage }];

export default defineConfig(
  globalIgnores(['.agents/', '.claude/', '**/node_modules/', '**/dist/', '**/coverage/', 'src/adapters/prisma/generated/', 'web/.next/', 'web/next-env.d.ts']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    name: 'aeolus/all-files',
    plugins: { 'check-file': checkFile },
    rules: {
      'max-params': 'off',
      '@typescript-eslint/max-params': ['error', { max: 2 }],
      'no-restricted-exports': [
        'error',
        { restrictDefaultExports: { direct: true, named: true, defaultFrom: true, namedFrom: true, namespaceFrom: true } },
      ],
      // Dotted suffixes such as .test and .global-setup are not checked.
      'check-file/filename-naming-convention': ['error', { '**/*.{js,ts}': 'KEBAB_CASE' }, { ignoreMiddleExtensions: true }],
      'no-restricted-properties': ['error', ...noModuleMocks],
    },
  },
  {
    name: 'aeolus/all-files-typed',
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        // A destructured name is its source's name, checked where that is declared.
        { selector: ['variable', 'parameter'], modifiers: ['destructured'], types: ['boolean'], format: null },
        {
          selector: ['variable', 'parameter', 'classProperty', 'parameterProperty', 'typeProperty', 'accessor'],
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'can', 'should', 'was', 'did'],
        },
      ],
    },
  },
  {
    // Tools read their config files' default export, and Next.js its route files' (typescript skill).
    name: 'aeolus/default-export-required',
    files: ['*.config.{js,ts}', 'web/*.config.{mjs,ts}', 'web/app/**/{layout,page,not-found,error}.tsx'],
    rules: { 'no-restricted-exports': 'off' },
  },

  {
    name: 'aeolus/prisma-in-its-adapter',
    ignores: ['src/adapters/prisma/**'],
    rules: importRules({ patterns: prismaOutsideItsAdapter }),
  },
  {
    // The core holds no framework, Prisma, MCP SDK or adapter, reads no clock and never throws.
    name: 'aeolus/core',
    files: ['src/core/**/*.ts'],
    rules: {
      ...importRules({ patterns: [...coreForbiddenImports, ...coreImpure.imports], syntax: coreImpure.syntax }),
      'no-restricted-properties': ['error', ...noModuleMocks, ...noTestDoubles, ...coreImpure.properties],
      'no-restricted-globals': ['error', ...coreImpure.globals],
    },
  },

  {
    name: 'aeolus/bridge',
    files: ['bridge/**/*.{ts,tsx}'],
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, ...bridgeForbiddenImports] }),
  },
  {
    // Repeats the Prisma list: this block's import rules replace the all-files ones for its files.
    name: 'aeolus/mcp-side-adapters',
    files: mcpSideAdapterFiles,
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, ...mcpSideForbiddenImports] }),
  },
  {
    // Repeats the core lists: this block's import rules replace the core block's for its files.
    name: 'aeolus/mcp-side-core',
    files: mcpSideCoreFiles,
    rules: importRules({ patterns: [...coreForbiddenImports, ...coreImpure.imports, ...mcpSideForbiddenImports], syntax: coreImpure.syntax }),
  },

  {
    name: 'aeolus/e2e-tests',
    files: e2eTestFiles,
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, ...sleepImports], syntax: e2eSyntax }),
  },
  {
    // Repeats the e2e list: this block's import rules replace the e2e block's for its files.
    name: 'aeolus/e2e-tests-in-bridge',
    files: ['bridge/**/*.{browser,e2e}.test.{ts,tsx}'],
    rules: importRules({ patterns: [...prismaOutsideItsAdapter, ...bridgeForbiddenImports, ...sleepImports], syntax: e2eSyntax }),
  },
);
