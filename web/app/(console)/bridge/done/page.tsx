import type { Metadata } from 'next';

import { BridgeDonePage } from '../../../../features/bridge/state/bridge-done';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Done' };

export default async function DonePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeDonePage searchParams={await searchParams} />;
}
