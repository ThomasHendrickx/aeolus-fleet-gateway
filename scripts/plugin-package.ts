/**
 * The ChatGPT plugin's package (chatgpt-plugin design, 7.2): plugin.json at
 * the gateway's version, mcp.json and the logo, zipped, and nothing else.
 * The check refuses a package that breaks OpenAI's limits, each problem
 * naming its field: the listing's texts, category and URLs, the logo, the
 * review cases and the tools they name, the package's name and version, and
 * any secret in mcp.json. A tool the gateway serves without its three hints
 * is refused too, as OpenAI requires each (annotations_required).
 */
import { z } from 'zod';

import { err, ok, type Result } from '../src/core/shared/result.ts';
import { writeZip } from './zip.ts';

const AGENT_PLUGINS_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

/** The one address the listing's server is at: changing it needs OpenAI support (design 7.6). */
export const PLUGIN_ADDRESS = 'https://gateway.aeolus-fleet.dev/plugin/mcp';

/** OpenAI's categories, spelled as plugin_category_unknown lists them. */
const CATEGORIES = [
  'Productivity',
  'Creativity',
  'Developer Tools',
  'Business & Operations',
  'Data & Analytics',
  'Communication',
  'Education & Research',
  'Security',
  'Finance',
  'Healthcare',
  'Travel',
  'Entertainment',
  'Other',
] as const;

const NAME_LIMIT = 30;
const LONG_DESCRIPTION_LIMIT = 4000;
const DESCRIPTION_LIMIT = 1024;
const AUTHOR_NAME_LIMIT = 120;
const DEVELOPER_NAME_LIMIT = 80;
const CAPABILITY_LIMIT = 120;
const MOST_CAPABILITIES = 20;
const PROMPT_LIMIT = 128;
const MOST_PROMPTS = 3;
const URL_LIMIT = 1024;
const POSITIVE_CASES = 5;
const NEGATIVE_CASES = 3;
const LOGO_MIN_PIXELS = 48;
const LOGO_MAX_PIXELS = 4096;
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** The three hints OpenAI requires on every tool, each an explicit boolean. */
const HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const;

/** The package as plugin/ holds it: the two manifests, and the other files by their path inside the package. */
export interface PluginSource {
  pluginJson: unknown;
  mcpJson: unknown;
  files: ReadonlyMap<string, Uint8Array>;
}

/** A tool the gateway serves a person, as the check reads it. */
export interface ServedTool {
  readonly name: string;
  readonly annotations?: Readonly<Record<string, unknown>>;
}

export interface PluginContext {
  /** The gateway's version, from its package.json: the package carries the same. */
  gatewayVersion: string;
  tools: readonly ServedTool[];
  /** The name the previous release's package shipped, if there was one. */
  previousName: string | undefined;
}

const oneLine = (limit: number) =>
  z
    .string()
    .min(1)
    .max(limit, `must hold at most ${String(limit)} characters`)
    .refine((text) => !/[\r\n]/.test(text), 'must be one line');

/** Whether a URL is HTTPS with no user name or password in it. */
function isHttpsWithoutCredentials(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

const httpsUrl = z
  .string()
  .max(URL_LIMIT, `must hold at most ${String(URL_LIMIT)} characters`)
  .refine(isHttpsWithoutCredentials, 'must be an HTTPS URL with no credentials');

const pluginSchema = z.looseObject({
  $schema: z.literal(AGENT_PLUGINS_SCHEMA),
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'must start with a letter or digit and hold at most 64 letters, digits, _ and -'),
  version: z.string().optional(),
  description: z.string().min(1).max(DESCRIPTION_LIMIT),
  author: z.looseObject({ name: oneLine(AUTHOR_NAME_LIMIT), url: httpsUrl.optional() }),
  extensions: z.looseObject({
    'com.openai': z.looseObject({
      interface: z.looseObject({
        displayName: oneLine(NAME_LIMIT),
        shortDescription: oneLine(NAME_LIMIT),
        longDescription: z.string().min(1).max(LONG_DESCRIPTION_LIMIT, `must hold at most ${String(LONG_DESCRIPTION_LIMIT)} characters`),
        developerName: oneLine(DEVELOPER_NAME_LIMIT),
        category: z.enum(CATEGORIES, `must be one of ${CATEGORIES.join(', ')}`),
        capabilities: z.array(oneLine(CAPABILITY_LIMIT)).max(MOST_CAPABILITIES),
        websiteURL: httpsUrl,
        supportURL: httpsUrl,
        privacyPolicyURL: httpsUrl,
        termsOfServiceURL: httpsUrl,
        defaultPrompt: z.array(oneLine(PROMPT_LIMIT)).max(MOST_PROMPTS),
        logo: z.string(),
        composerIcon: z.string(),
      }),
      review: z.looseObject({
        test_cases: z.strictObject({
          positive: z
            .array(z.strictObject({ description: z.string().min(1), prompt: z.string().min(1), tools_triggered: z.string().min(1), expected_behavior: z.string().min(1) }))
            .length(POSITIVE_CASES, 'must hold exactly five positive cases'),
          negative: z.array(z.strictObject({ description: z.string().min(1), prompt: z.string().min(1) })).length(NEGATIVE_CASES, 'must hold exactly three negative cases'),
        }),
      }),
    }),
  }),
});

/** mcp.json: one server at the plugin address, signing in by OAuth with CIMD. Strict, so no header, secret or hook gets in. */
const mcpSchema = z.strictObject({
  $schema: z.literal(MCP_SCHEMA),
  mcpServers: z
    .record(
      z.string(),
      z.strictObject({
        type: z.literal('streamable-http'),
        url: z.literal(PLUGIN_ADDRESS),
        extensions: z.strictObject({ 'com.openai': z.strictObject({ auth: z.strictObject({ type: z.literal('oauth'), client: z.strictObject({ mode: z.literal('cimd') }) }) }) }),
      }),
    )
    .refine((servers) => Object.keys(servers).length === 1, 'must hold exactly one server'),
});

/** A problem per issue, naming its field by its path. */
const problemsOf = (file: string, issues: readonly z.core.$ZodIssue[]) => issues.map((issue) => `${file} ${issue.path.map(String).join('.')}: ${issue.message}`);

interface Pixels {
  width: number;
  height: number;
}

/** The size of an SVG from its width and height, or its viewBox. */
function svgPixels(bytes: Uint8Array): Pixels | undefined {
  const text = new TextDecoder().decode(bytes);
  const root = /<svg\b[^>]*>/.exec(text)?.[0];
  if (root === undefined) {
    return undefined;
  }
  const attribute = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1];
  const width = Number.parseFloat(attribute('width') ?? '');
  const height = Number.parseFloat(attribute('height') ?? '');
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { width, height };
  }
  const [, , boxWidth, boxHeight] = (attribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  return boxWidth !== undefined && boxHeight !== undefined && Number.isFinite(boxWidth) && Number.isFinite(boxHeight) ? { width: boxWidth, height: boxHeight } : undefined;
}

/** The size of a JPEG from its first start-of-frame marker. */
function jpegPixels(view: DataView): Pixels | undefined {
  let at = 2;
  while (at + 9 < view.byteLength && view.getUint8(at) === 0xff) {
    const marker = view.getUint8(at + 1);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    at += 2 + view.getUint16(at + 2);
  }
  return undefined;
}

/** The size of a WebP from its first chunk: lossy, lossless or extended. */
function webpPixels(view: DataView, bytes: Uint8Array): Pixels | undefined {
  const chunk = new TextDecoder().decode(bytes.subarray(12, 16));
  if (chunk === 'VP8 ' && view.byteLength >= 30) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L' && view.byteLength >= 25) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && view.byteLength >= 30) {
    const uint24 = (at: number) => view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
    return { width: uint24(24) + 1, height: uint24(27) + 1 };
  }
  return undefined;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((byte, index) => bytes[index] === byte);

/** An image's size in pixels, if it is a PNG, JPEG, WebP or SVG. */
function pixelsOf(bytes: Uint8Array): Pixels | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (startsWith(bytes, [0xff, 0xd8])) {
    return jpegPixels(view);
  }
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') {
    return webpPixels(view, bytes);
  }
  return svgPixels(bytes);
}

/** Why an image the listing names cannot be its logo, if it cannot. */
function imageProblem(path: string, files: ReadonlyMap<string, Uint8Array>): string | undefined {
  const bytes = path.startsWith('./') ? files.get(path.slice(2)) : undefined;
  if (bytes === undefined) {
    return `${path} must be a file in the package, named from its root with ./`;
  }
  if (bytes.length > LOGO_MAX_BYTES) {
    return `${path} must be at most 5 MiB`;
  }
  const pixels = pixelsOf(bytes);
  if (pixels === undefined) {
    return `${path} must be a PNG, JPEG, WebP or SVG`;
  }
  const isFit = pixels.width === pixels.height && pixels.width >= LOGO_MIN_PIXELS && pixels.width <= LOGO_MAX_PIXELS;
  return isFit ? undefined : `${path} is ${String(pixels.width)} by ${String(pixels.height)} pixels: it must be square, from 48 to 4096 pixels`;
}

/** The tools each positive case names, as OpenAI takes them: comma-separated. */
const toolsNamed = (toolsTriggered: string) => toolsTriggered.split(',').map((name) => name.trim());

/** Each problem with the package, or none. */
function problemsWith(source: PluginSource, context: PluginContext): { problems: string[]; plugin?: z.infer<typeof pluginSchema> } {
  const problems: string[] = [];
  for (const tool of context.tools) {
    const missing = HINTS.filter((hint) => typeof tool.annotations?.[hint] !== 'boolean');
    if (missing.length > 0) {
      problems.push(`tools ${tool.name}: lacks ${missing.join(', ')}, each an explicit boolean (annotations_required)`);
    }
  }
  const mcp = mcpSchema.safeParse(source.mcpJson);
  if (!mcp.success) {
    problems.push(...problemsOf('mcp.json', mcp.error.issues));
  }
  const parsed = pluginSchema.safeParse(source.pluginJson);
  if (!parsed.success) {
    problems.push(...problemsOf('plugin.json', parsed.error.issues));
    return { problems };
  }
  const plugin = parsed.data;
  if (plugin.version !== undefined && plugin.version !== context.gatewayVersion) {
    problems.push(`plugin.json version: is ${plugin.version}, the gateway's is ${context.gatewayVersion}; the build sets it`);
  }
  if (context.previousName !== undefined && plugin.name !== context.previousName) {
    problems.push(`plugin.json name: plugin_name_mismatch: the last release shipped ${context.previousName}, this one names ${plugin.name}`);
  }
  const openai = plugin.extensions['com.openai'];
  for (const field of ['logo', 'composerIcon'] as const) {
    const problem = imageProblem(openai.interface[field], source.files);
    if (problem !== undefined) {
      problems.push(`plugin.json extensions.com.openai.interface.${field}: ${problem}`);
    }
  }
  const served = new Set(context.tools.map(({ name }) => name));
  openai.review.test_cases.positive.forEach((positive, index) => {
    for (const name of toolsNamed(positive.tools_triggered).filter((named) => !served.has(named))) {
      problems.push(`plugin.json extensions.com.openai.review.test_cases.positive.${String(index)}.tools_triggered: ${name} is not a tool the gateway serves`);
    }
  });
  return { problems, plugin };
}

/** The package's ZIP and its plugin.json, or each problem with it. */
export function buildPlugin(source: PluginSource, context: PluginContext): Result<{ zip: Uint8Array; plugin: Record<string, unknown> }, readonly string[]> {
  const { problems, plugin } = problemsWith(source, context);
  if (problems.length > 0 || plugin === undefined) {
    return err(problems);
  }
  // The gateway's version, placed after the name as OpenAI's examples place it.
  const stamped = Object.fromEntries([
    ['$schema', plugin.$schema],
    ['name', plugin.name],
    ['version', context.gatewayVersion],
    ...Object.entries(plugin).filter(([key]) => !['$schema', 'name', 'version'].includes(key)),
  ]);
  const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  const images = new Set([plugin.extensions['com.openai'].interface.logo, plugin.extensions['com.openai'].interface.composerIcon].map((path) => path.slice(2)));
  const files = new Map<string, Uint8Array>([
    ['plugin.json', json(stamped)],
    ['mcp.json', json(source.mcpJson)],
    ...[...images].flatMap((path): [string, Uint8Array][] => {
      const bytes = source.files.get(path);
      return bytes === undefined ? [] : [[path, bytes]];
    }),
  ]);
  return ok({ zip: writeZip(files), plugin: stamped });
}
