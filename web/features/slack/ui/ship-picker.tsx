'use client';

import { Combobox } from '@base-ui/react/combobox';
import { useState } from 'react';

interface ShipItem {
  value: string;
  label: string;
}

/** Picks one ship to expose by its name, searched; the form sends its id. */
export function ShipPicker({ ships }: { ships: readonly { shipId: string; name: string }[] }) {
  const items: ShipItem[] = ships.map(({ shipId, name }) => ({ value: shipId, label: name }));
  const [picked, setPicked] = useState<ShipItem | null>(null);
  return (
    <Combobox.Root items={items} value={picked} onValueChange={(next: ShipItem | null) => {
        setPicked(next);
      }}
      isItemEqualToValue={(item: ShipItem | null, chosen: ShipItem | null) => item?.value === chosen?.value}
    >
      <input type="hidden" name="shipId" value={picked?.value ?? ''} />
      <div className="grid gap-1" data-testid="slack-ship-picker">
        <Combobox.Label className="font-medium">Ship</Combobox.Label>
        <Combobox.Input placeholder="Search the agent ships and A2A agents" className="h-9 w-full rounded-md border border-input bg-background px-3" />
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-72 w-(--anchor-width) overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <Combobox.Empty className="px-2 py-1 text-muted-foreground">No ship matches.</Combobox.Empty>
            <Combobox.List>
              {(item: ShipItem) => (
                <Combobox.Item key={item.value} value={item} className="cursor-default rounded-sm px-2 py-1 data-highlighted:bg-accent">
                  {item.label}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
