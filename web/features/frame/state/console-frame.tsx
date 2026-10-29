import type { ReactNode } from 'react';

import { readTheme } from '../hooks/read-theme';
import { Frame } from '../ui/frame';
import { Header } from './header';

/** The frame of the gateway's own pages: the header every Aeolus app shows, for the account signed in. */
export async function ConsoleFrame({ children }: { children: ReactNode }) {
  return <Frame header={<Header theme={await readTheme()} />}>{children}</Frame>;
}
