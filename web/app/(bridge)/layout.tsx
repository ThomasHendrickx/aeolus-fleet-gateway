import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { BRIDGE_PAGE_TITLE } from '../../lib/page-title';

export const metadata: Metadata = { title: BRIDGE_PAGE_TITLE };

/** Every Bridge page carries the Bridge title; the root layout titles the rest of the gateway's pages. */
export default function BridgeLayout({ children }: { children: ReactNode }) {
  return children;
}
