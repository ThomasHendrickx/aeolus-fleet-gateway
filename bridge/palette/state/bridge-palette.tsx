'use client';

import type { AppPaletteGroup } from '@aeolus-fleet/common/rules';
import { appPaletteGroupOf, CommandPalette, type CommandGroup } from '@aeolus-fleet/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { bridgePaletteGroupsOf, type OwnPaletteGroup } from '../services/palette-groups';

/** What Bridge's palette offers: its own entries, and the other apps' as the server reads them, which may come after the page. */
export interface BridgePaletteEntries {
  readonly own: readonly OwnPaletteGroup[];
  readonly otherApps: Promise<readonly AppPaletteGroup[]>;
}

/** One of Bridge's own groups as the palette shows it: each entry with its icon, a page opening here, Copy MCP address copying. */
function ownGroupOf(group: OwnPaletteGroup): CommandGroup {
  const shown = appPaletteGroupOf({ app: 'gateway', label: group.label, entries: group.entries });
  // Its own pages open in Bridge: no app is named at the row's end, and the palette hands them to onSelect.
  return { key: group.key, label: group.label, entries: shown.entries.map(({ key, content, copyText }) => ({ key, content, ...(copyText === undefined ? {} : { copyText }) })) };
}

/**
 * The command palette in Bridge (aeolus-fleet, header-across-apps A2, M2;
 * the approved sheets): Bridge's own actions and pages first, then each
 * other app the account may open, under its name, each entry naming the app
 * it opens. ⌘K (Ctrl+K) or the top bar's search opens it. A page of Bridge
 * opens here; Copy MCP address copies and says Copied; another app's entry
 * says it is opening until it does.
 */
export function BridgePalette({ entries, isOpen, onOpenChange }: { entries: BridgePaletteEntries; isOpen: boolean; onOpenChange: (isOpen: boolean) => void }) {
  const router = useRouter();
  const [otherApps, setOtherApps] = useState<readonly AppPaletteGroup[]>([]);

  useEffect(() => {
    let isCurrent = true;
    void entries.otherApps.then((read) => {
      if (isCurrent) {
        setOtherApps(read);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [entries.otherApps]);

  useEffect(() => {
    const openOnShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener('keydown', openOnShortcut);
    return () => {
      document.removeEventListener('keydown', openOnShortcut);
    };
  }, [onOpenChange]);

  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="Search or jump to"
      groupsOf={(query) => {
        const { own, others } = bridgePaletteGroupsOf({ own: entries.own, otherApps, query });
        return [...own.map(ownGroupOf), ...others.map(appPaletteGroupOf)];
      }}
      emptyMessage={(query) => `No match for “${query}”`}
      onSelect={(key) => {
        const href = entries.own.flatMap((group) => group.entries).find((entry) => entry.key === key)?.href;
        if (href !== undefined) {
          onOpenChange(false);
          router.push(href);
        }
      }}
    />
  );
}
