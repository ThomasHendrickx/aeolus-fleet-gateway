import { describe, expect, it } from 'vitest';

import { comparePlugin, pluginNotes, type PluginRelease } from './plugin-build.ts';
import { writeZip } from './zip.ts';

// The release flow (chatgpt-plugin design, 7.6): each release says whether
// its package differs from the previous release's, and names the tools that
// are new or changed, for Thomas to upload, Rescan or appeal.

const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const LOGO = new Uint8Array([1, 2, 3]);

const INBOX = { name: 'aeolus_inbox', description: 'Your inbox.', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
const PING = { name: 'aeolus_ping', description: 'Pings.', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };

/** A release's package and tools: plugin.json at its version with the long description given. */
function aRelease(release: { version: string; longDescription?: string; tools?: readonly unknown[] }): PluginRelease {
  const plugin = { name: 'aeolus', version: release.version, extensions: { 'com.openai': { interface: { longDescription: release.longDescription ?? 'Your AI team is working.' } } } };
  return {
    zip: writeZip(
      new Map([
        ['plugin.json', encoded(plugin)],
        ['mcp.json', encoded({ mcpServers: {} })],
        ['assets/logo.png', LOGO],
      ]),
    ),
    tools: release.tools ?? [INBOX],
  };
}

describe('the release flow', () => {
  it('a release that changes no tool and no text uploads nothing: the release says the package is unchanged', () => {
    const comparison = comparePlugin({ previous: aRelease({ version: '0.33.0' }), current: aRelease({ version: '0.33.1' }) });

    expect(comparison).toEqual({ isPackageChanged: false, newTools: [], changedTools: [], removedTools: [] });
    expect(pluginNotes(comparison)).toContain('The plugin package is unchanged');
  });

  it('a release that adds a tool names it as a new tool for OpenAI to approve, and the existing tools as unchanged', () => {
    const comparison = comparePlugin({ previous: aRelease({ version: '0.33.0' }), current: aRelease({ version: '0.34.0', tools: [INBOX, PING] }) });

    expect(comparison).toEqual({ isPackageChanged: false, newTools: ['aeolus_ping'], changedTools: [], removedTools: [] });
    expect(pluginNotes(comparison)).toContain('New tools for OpenAI to approve: aeolus_ping');
  });

  it('names a tool whose description changed', () => {
    const comparison = comparePlugin({ previous: aRelease({ version: '0.33.0' }), current: aRelease({ version: '0.34.0', tools: [{ ...INBOX, description: 'What waits.' }] }) });

    expect(comparison.changedTools).toEqual(['aeolus_inbox']);
  });

  it('a release that changes the package carries a new version: the release says to upload its ZIP', () => {
    const comparison = comparePlugin({ previous: aRelease({ version: '0.33.0' }), current: aRelease({ version: '0.34.0', longDescription: 'Stay part of the conversation.' }) });

    expect(comparison.isPackageChanged).toBe(true);
    expect(pluginNotes(comparison)).toContain('The plugin package changed');
  });

  it('the first release with a plugin says to upload its ZIP', () => {
    const comparison = comparePlugin({ previous: undefined, current: aRelease({ version: '0.33.0' }) });

    expect(comparison).toEqual({ isPackageChanged: true, newTools: ['aeolus_inbox'], changedTools: [], removedTools: [] });
  });
});
