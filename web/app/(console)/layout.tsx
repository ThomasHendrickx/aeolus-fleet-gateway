import type { ReactNode } from 'react';

import { ConsoleFrame } from '../../features/frame/state/console-frame';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <ConsoleFrame>{children}</ConsoleFrame>;
}
