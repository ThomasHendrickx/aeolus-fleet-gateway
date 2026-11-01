import type { Metadata } from 'next';

import { BridgeRoutingPage } from '../../../../../features/bridge/state/bridge-routing';
import type { SearchParams } from '../../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Where things show' };

export default async function RoutingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeRoutingPage searchParams={await searchParams} />;
}
