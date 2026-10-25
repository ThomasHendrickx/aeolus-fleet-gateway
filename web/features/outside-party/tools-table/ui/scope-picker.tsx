'use client';

import { Combobox } from '@base-ui/react/combobox';

import type { ListedScope } from './needs-chips';

interface ScopeItem {
  value: string;
  label: string;
  description: string;
}

const itemOf = ({ scope, description }: ListedScope): ScopeItem => ({ value: scope, label: scope, description });

/**
 * Picks several of the fleet's listed scopes (gateway scopes 4.3), searched
 * by name or description. A scope picked before that the fleet no longer
 * lists stays picked, so it can be seen and removed.
 */
export function ScopePicker({ label, listed, picked, onPick, isDisabled = false, testId }: { label: string; listed: readonly ListedScope[]; picked: readonly string[]; onPick: (scopes: string[]) => void; isDisabled?: boolean; testId?: string }) {
  const { contains } = Combobox.useFilter();
  const items = [...listed.map(itemOf), ...picked.filter((scope) => !listed.some((each) => each.scope === scope)).map((scope) => ({ value: scope, label: scope, description: 'No longer defined in the fleet' }))];
  const value = items.filter((item) => picked.includes(item.value));
  return (
    <Combobox.Root
      multiple
      items={items}
      value={value}
      disabled={isDisabled}
      isItemEqualToValue={(item, chosen) => item.value === chosen.value}
      onValueChange={(next: ScopeItem[]) => {
        onPick(next.map((item) => item.value));
      }}
      filter={(item: ScopeItem, query) => contains(item.label, query) || contains(item.description, query)}
    >
      <div className="grid gap-1" data-testid={testId}>
        <Combobox.Label className="font-medium">{label}</Combobox.Label>
        <Combobox.InputGroup className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1">
          <Combobox.Chips className="contents">
            {value.map((item) => (
              <Combobox.Chip key={item.value} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 font-mono text-caption" aria-label={item.value}>
                {item.value}
                <Combobox.ChipRemove className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${item.value}`}>
                  ×
                </Combobox.ChipRemove>
              </Combobox.Chip>
            ))}
            <Combobox.Input placeholder={value.length === 0 ? 'Search the fleet\'s scopes' : ''} className="h-7 min-w-32 flex-1 bg-transparent outline-none" />
          </Combobox.Chips>
        </Combobox.InputGroup>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-72 w-(--anchor-width) overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <Combobox.Empty className="px-2 py-1 text-muted-foreground">No scope listed matches.</Combobox.Empty>
            <Combobox.List>
              {(item: ScopeItem) => (
                <Combobox.Item key={item.value} value={item} className="grid cursor-default grid-cols-[1rem_1fr] gap-x-2 rounded px-2 py-1 data-highlighted:bg-accent">
                  <Combobox.ItemIndicator className="row-span-2">✓</Combobox.ItemIndicator>
                  <span className="col-start-2 font-mono text-code">{item.value}</span>
                  <span className="col-start-2 text-caption text-muted-foreground">{item.description}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
