import { describe, expect, it } from 'vitest';

import { PERSON_TOOLS } from '../src/adapters/http/person-tools.ts';
import { buildPlugin, type PluginSource, type ServedTool } from './plugin-package.ts';
import { readPluginSource } from './plugin-build.ts';
import { readZip } from './zip.ts';

// The ChatGPT plugin's package (chatgpt-plugin design, 7.2): the connection
// and nothing else, refused with the field named when it breaks OpenAI's limits.

const PLUGIN_ADDRESS = 'https://gateway.aeolus-fleet.dev/plugin/mcp';

/** A PNG's signature and header chunk, as far as a reader of its size reads it. */
function aPng(size: { width: number; height: number }): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, size.width);
  view.setUint32(20, size.height);
  return bytes;
}

const A_TOOL: ServedTool = { name: 'aeolus_inbox', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };

/** A positive review case naming the tools it triggers. */
const aPositiveCase = (toolsTriggered = 'aeolus_inbox') => ({ description: 'Read the inbox', prompt: 'What needs my attention in Aeolus?', tools_triggered: toolsTriggered, expected_behavior: 'Names what waits.' });
const aNegativeCase = () => ({ description: 'Delete a message', prompt: 'Delete every message in my Aeolus inbox' });

/** A valid package source, with what a test overrides. */
function aSource(overrides: { interface?: Record<string, unknown>; positive?: unknown[]; negative?: unknown[]; name?: string; version?: string; server?: Record<string, unknown>; logo?: Uint8Array } = {}): PluginSource {
  return {
    pluginJson: {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: overrides.name ?? 'aeolus',
      ...(overrides.version === undefined ? {} : { version: overrides.version }),
      description: 'Stay in sync with your AI team',
      author: { name: 'Thomas Hendrickx', url: 'https://aeolus-fleet.dev' },
      extensions: {
        'com.openai': {
          interface: {
            displayName: 'Aeolus',
            shortDescription: 'Stay in sync with your AI team',
            longDescription: 'Your AI team is working. Stay part of the conversation.',
            developerName: 'Thomas Hendrickx',
            category: 'Productivity',
            capabilities: [],
            websiteURL: 'https://aeolus-fleet.dev',
            supportURL: 'https://aeolus-fleet.dev/support',
            privacyPolicyURL: 'https://pagasae.aeolus-fleet.dev/privacy',
            termsOfServiceURL: 'https://pagasae.aeolus-fleet.dev/terms',
            defaultPrompt: ['What needs my attention in Aeolus?'],
            composerIcon: './assets/logo.png',
            logo: './assets/logo.png',
            ...overrides.interface,
          },
          review: { test_cases: { positive: overrides.positive ?? Array.from({ length: 5 }, () => aPositiveCase()), negative: overrides.negative ?? Array.from({ length: 3 }, aNegativeCase) }, commerce: false },
        },
      },
    },
    mcpJson: {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { aeolus: { type: 'streamable-http', url: PLUGIN_ADDRESS, extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'cimd' } } } }, ...overrides.server } },
    },
    files: new Map([['assets/logo.png', overrides.logo ?? aPng({ width: 180, height: 180 })]]),
  };
}

const CONTEXT = { gatewayVersion: '0.33.0', tools: [A_TOOL], previousName: undefined };

/** The problems the build refuses the source with, or none. */
function problemsOf(source: PluginSource, context: Partial<typeof CONTEXT> & { previousName?: string; tools?: readonly ServedTool[] } = {}): readonly string[] {
  const built = buildPlugin(source, { ...CONTEXT, ...context });
  return built.isOk ? [] : built.error;
}

describe('the package', () => {
  it('the package is the connection and nothing else: plugin.json, mcp.json and the logo, one streamable-http server at the plugin address, oauth with cimd, no headers, secret or hooks', async () => {
    const built = buildPlugin(await readPluginSource(new URL('../plugin', import.meta.url)), { gatewayVersion: '0.33.0', tools: PERSON_TOOLS, previousName: 'aeolus' });
    if (!built.isOk) {
      throw new Error(built.error.join('\n'));
    }
    const entries = readZip(built.value.zip);
    const mcp: unknown = JSON.parse(new TextDecoder().decode(entries.get('mcp.json')));

    expect([...entries.keys()].toSorted()).toEqual(['assets/logo.png', 'mcp.json', 'plugin.json']);
    expect(mcp).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { aeolus: { type: 'streamable-http', url: PLUGIN_ADDRESS, extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'cimd' } } } } } },
    });
  });

  it('the version is the gateway\'s: plugin.json says the version package.json says', () => {
    const built = buildPlugin(aSource(), CONTEXT);

    expect(built.isOk && JSON.parse(new TextDecoder().decode(readZip(built.value.zip).get('plugin.json')))).toMatchObject({ version: '0.33.0' });
  });

  it('refuses a version in plugin.json other than the gateway\'s, naming version', () => {
    expect(problemsOf(aSource({ version: '0.32.0' }))).toEqual([expect.stringContaining('version')]);
  });

  it('a display name exactly at the limit builds', () => {
    expect(problemsOf(aSource({ interface: { displayName: 'A'.repeat(30) } }))).toEqual([]);
  });

  it('a display name one over the limit is refused, naming displayName', () => {
    expect(problemsOf(aSource({ interface: { displayName: 'A'.repeat(31) } }))).toEqual([expect.stringContaining('displayName')]);
  });

  it('a display name on more than one line is refused, naming displayName', () => {
    expect(problemsOf(aSource({ interface: { displayName: 'Aeo\nlus' } }))).toEqual([expect.stringContaining('displayName')]);
  });

  it('a short description exactly at the limit builds, one over is refused, naming shortDescription', () => {
    expect(problemsOf(aSource({ interface: { shortDescription: 'S'.repeat(30) } }))).toEqual([]);
    expect(problemsOf(aSource({ interface: { shortDescription: 'S'.repeat(31) } }))).toEqual([expect.stringContaining('shortDescription')]);
  });

  it('a long description exactly at the limit builds, one over is refused, naming longDescription', () => {
    expect(problemsOf(aSource({ interface: { longDescription: 'L'.repeat(4000) } }))).toEqual([]);
    expect(problemsOf(aSource({ interface: { longDescription: 'L'.repeat(4001) } }))).toEqual([expect.stringContaining('longDescription')]);
  });

  it('refuses a category outside OpenAI\'s 13, naming category', () => {
    expect(problemsOf(aSource({ interface: { category: 'Fleets' } }))).toEqual([expect.stringContaining('category')]);
  });

  it.each([
    ['not HTTPS', 'http://aeolus-fleet.dev/support'],
    ['over 1024 characters', `https://aeolus-fleet.dev/${'s'.repeat(1000)}`],
    ['holding credentials', 'https://thomas:secret@aeolus-fleet.dev/support'],
  ])('refuses a URL %s, naming the field', (_what, url) => {
    expect(problemsOf(aSource({ interface: { supportURL: url } }))).toEqual([expect.stringContaining('supportURL')]);
  });

  it('exactly five positive and three negative cases build', () => {
    expect(problemsOf(aSource())).toEqual([]);
  });

  it.each([
    [4, 3],
    [6, 3],
    [5, 2],
    [5, 4],
  ])('%i positive and %i negative cases are refused, naming the case count', (positive, negative) => {
    const source = aSource({ positive: Array.from({ length: positive }, () => aPositiveCase()), negative: Array.from({ length: negative }, aNegativeCase) });

    expect(problemsOf(source)).toEqual([expect.stringMatching(/review\.test_cases\.(positive|negative).*(five|three)/)]);
  });

  it('a positive case naming a tool the gateway does not serve is refused, naming the tool', () => {
    const source = aSource({ positive: [aPositiveCase('aeolus_inbox, aeolus_delete'), ...Array.from({ length: 4 }, () => aPositiveCase())] });

    expect(problemsOf(source)).toEqual([expect.stringContaining('aeolus_delete')]);
  });

  it('a logo that is not square or is under 48 pixels is refused; one of 48 by 48 builds', () => {
    expect(problemsOf(aSource({ logo: aPng({ width: 64, height: 48 }) }))).toEqual([expect.stringContaining('logo'), expect.stringContaining('composerIcon')]);
    expect(problemsOf(aSource({ logo: aPng({ width: 47, height: 47 }) }))).toEqual([expect.stringContaining('logo'), expect.stringContaining('composerIcon')]);
    expect(problemsOf(aSource({ logo: aPng({ width: 48, height: 48 }) }))).toEqual([]);
  });

  it('refuses a logo that is not PNG, JPEG, WebP or SVG, naming the field', () => {
    expect(problemsOf(aSource({ logo: new TextEncoder().encode('GIF89a') }))).toEqual([expect.stringContaining('logo'), expect.stringContaining('composerIcon')]);
  });

  it('a name that changed since the last release is refused, naming plugin_name_mismatch', () => {
    expect(problemsOf(aSource({ name: 'aeolus-chat' }), { previousName: 'aeolus' })).toEqual([expect.stringContaining('plugin_name_mismatch')]);
  });

  it.each([
    ['clientSecret', { extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'cimd' }, clientSecret: 's' } } } }],
    ['headers', { headers: { authorization: 'Bearer s' } }],
  ])('a secret in the package is refused, naming %s', (field, server) => {
    expect(problemsOf(aSource({ server }))).toEqual([expect.stringContaining(field)]);
  });
});

describe('the tools the package names', () => {
  it('a release with a tool lacking a hint fails, naming the tool', () => {
    const tools = [A_TOOL, { name: 'aeolus_ping', annotations: { readOnlyHint: true, destructiveHint: false } }];

    expect(problemsOf(aSource(), { tools })).toEqual([expect.stringContaining('aeolus_ping')]);
  });

  it('every tool the gateway serves a person carries its three hints', () => {
    expect(problemsOf(aSource(), { tools: PERSON_TOOLS })).toEqual([]);
  });
});
