/**
 * Builds the ChatGPT plugin's package from plugin/ at the gateway's version
 * (chatgpt-plugin design, 7.2, 7.6): its ZIP, the tools the gateway serves a
 * person as JSON, and the release's notes on both. Given the previous
 * release's two files, the notes say whether the package changed, so Thomas
 * uploads it, and name the tools that are new, changed or removed, for
 * OpenAI to approve after a Rescan. Any problem with the package fails it.
 *
 * Usage: tsx scripts/plugin-build.ts [--previous <dir with the last release's aeolus-*.zip and aeolus-*.tools.json>] [--out <dir>, dist unless set]
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { PERSON_TOOLS } from '../src/adapters/http/person-tools.ts';
import { buildPlugin, type PluginSource } from './plugin-package.ts';
import { readZip } from './zip.ts';

/** A release's plugin: its ZIP and the tools it served. */
export interface PluginRelease {
  zip: Uint8Array;
  tools: readonly unknown[];
}

export interface PluginComparison {
  isPackageChanged: boolean;
  newTools: string[];
  changedTools: string[];
  removedTools: string[];
}

const namedSchema = z.looseObject({ name: z.string() });
const pluginNameSchema = z.looseObject({ name: z.string(), version: z.string().optional() });

/** plugin/ as the build reads it: the two manifests, and every other file by its path inside the folder. */
export async function readPluginSource(folder: URL): Promise<PluginSource> {
  const root = new URL(folder.href.endsWith('/') ? folder.href : `${folder.href}/`);
  const json = async (name: string): Promise<unknown> => JSON.parse(await readFile(new URL(name, root), 'utf8'));
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, Uint8Array>();
  for (const entry of entries.filter((each) => each.isFile())) {
    const path = join(entry.parentPath, entry.name).slice(root.pathname.length);
    if (path !== 'plugin.json' && path !== 'mcp.json') {
      files.set(path, new Uint8Array(await readFile(join(entry.parentPath, entry.name))));
    }
  }
  return { pluginJson: await json('plugin.json'), mcpJson: await json('mcp.json'), files };
}

/** plugin.json without its version, so a release that changes nothing else compares equal. */
function withoutVersion(bytes: Uint8Array | undefined): string {
  if (bytes === undefined) {
    return '';
  }
  const plugin = pluginNameSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  return JSON.stringify({ ...plugin, version: null });
}

/** Whether two packages hold the same files with the same content, apart from the version. */
function isSamePackage(previous: Uint8Array, current: Uint8Array): boolean {
  const before = readZip(previous);
  const after = readZip(current);
  if ([...before.keys()].join('\n') !== [...after.keys()].join('\n')) {
    return false;
  }
  return [...after].every(([path, bytes]) => (path === 'plugin.json' ? withoutVersion(before.get(path)) === withoutVersion(bytes) : Buffer.from(before.get(path) ?? []).equals(bytes)));
}

/** What changed since the previous release's plugin; with none, the whole package and every tool are new. */
export function comparePlugin(releases: { previous: PluginRelease | undefined; current: PluginRelease }): PluginComparison {
  const { previous, current } = releases;
  const byName = (tools: readonly unknown[]) => new Map(tools.map((tool) => [namedSchema.parse(tool).name, JSON.stringify(tool)]));
  const before = byName(previous?.tools ?? []);
  const after = byName(current.tools);
  return {
    isPackageChanged: previous === undefined || !isSamePackage(previous.zip, current.zip),
    newTools: [...after.keys()].filter((name) => !before.has(name)),
    changedTools: [...after].filter(([name, tool]) => before.has(name) && before.get(name) !== tool).map(([name]) => name),
    removedTools: [...before.keys()].filter((name) => !after.has(name)),
  };
}

/** The release notes' section on the plugin: what to upload, and which tools OpenAI approves. */
export function pluginNotes(comparison: PluginComparison): string {
  const lines = [
    '## The ChatGPT plugin',
    '',
    comparison.isPackageChanged
      ? 'The plugin package changed: upload the plugin ZIP attached to this release to the plugin in OpenAI\'s portal.'
      : 'The plugin package is unchanged: upload nothing.',
  ];
  const tools = [
    ['New tools for OpenAI to approve', comparison.newTools],
    ['Changed tools for OpenAI to approve', comparison.changedTools],
    ['Removed tools', comparison.removedTools],
  ] as const;
  for (const [heading, names] of tools.filter(([, names]) => names.length > 0)) {
    lines.push('', `${heading}: ${names.join(', ')}.`);
  }
  if (tools.some(([, names]) => names.length > 0)) {
    lines.push('', 'Press Rescan in the portal; OpenAI holds a new or changed tool until it approves it.');
  }
  return `${lines.join('\n')}\n`;
}

/** The previous release's plugin, from the folder its two files were downloaded to, if any. */
async function previousRelease(folder: string | undefined): Promise<PluginRelease | undefined> {
  if (folder === undefined) {
    return undefined;
  }
  const names = await readdir(folder);
  const zip = names.find((name) => /^aeolus-.+\.zip$/.test(name));
  const tools = names.find((name) => /^aeolus-.+\.tools\.json$/.test(name));
  if (zip === undefined || tools === undefined) {
    return undefined;
  }
  return { zip: new Uint8Array(await readFile(join(folder, zip))), tools: z.array(z.unknown()).parse(JSON.parse(await readFile(join(folder, tools), 'utf8'))) };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { previous: { type: 'string' }, out: { type: 'string', default: 'dist' } } });
  const { version } = z.object({ version: z.string() }).parse(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')));
  const previous = await previousRelease(values.previous);
  const previousName = previous === undefined ? undefined : pluginNameSchema.parse(JSON.parse(new TextDecoder().decode(readZip(previous.zip).get('plugin.json')))).name;
  const built = buildPlugin(await readPluginSource(new URL('../plugin', import.meta.url)), { gatewayVersion: version, tools: PERSON_TOOLS, previousName });
  if (!built.isOk) {
    throw new Error(`The plugin package is refused:\n${built.error.map((problem) => `- ${problem}`).join('\n')}`);
  }
  const notes = pluginNotes(comparePlugin({ previous, current: { zip: built.value.zip, tools: PERSON_TOOLS } }));
  await mkdir(values.out, { recursive: true });
  await writeFile(join(values.out, `aeolus-${version}.zip`), built.value.zip);
  await writeFile(join(values.out, `aeolus-${version}.tools.json`), `${JSON.stringify(PERSON_TOOLS, null, 2)}\n`);
  await writeFile(join(values.out, `aeolus-${version}.notes.md`), notes);
  process.stdout.write(notes);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
