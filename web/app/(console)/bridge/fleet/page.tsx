import type { Metadata } from 'next';

import { BridgeFleetPage } from '../../../../features/bridge/fleet/state/bridge-fleet';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Your fleet' };

export default async function BridgeFleetRoute({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeFleetPage searchParams={await searchParams} />;
}
