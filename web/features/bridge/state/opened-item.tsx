'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { OpenedItem } from '../ui/bridge-top-bar';

const OpenedItemContext = createContext<{ opened: OpenedItem | undefined; setOpened: (opened: OpenedItem | undefined) => void } | undefined>(undefined);

/** Holds the item open in place of its list, if any, for the shell's phone title. */
export function OpenedItemProvider({ children }: { children: (opened: OpenedItem | undefined) => ReactNode }) {
  const [opened, setOpened] = useState<OpenedItem | undefined>();
  return <OpenedItemContext value={{ opened, setOpened }}>{children(opened)}</OpenedItemContext>;
}

/**
 * Names the item open in place of its list to the shell, by its title, the
 * back chevron closing it; undefined while none is open. Outside Bridge's
 * shell it does nothing.
 */
export function useOpenedItem(title: string | undefined, onBack: () => void): void {
  const setOpened = useContext(OpenedItemContext)?.setOpened;
  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  });
  useEffect(() => {
    if (setOpened === undefined) {
      return undefined;
    }
    setOpened(title === undefined ? undefined : { title, onBack: () => { back.current(); } });
    return () => {
      setOpened(undefined);
    };
  }, [setOpened, title]);
}
