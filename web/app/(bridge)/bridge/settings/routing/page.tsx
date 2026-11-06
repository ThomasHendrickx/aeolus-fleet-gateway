import { BridgeRoutingPage } from '../../../../../features/bridge/state/bridge-routing';
import type { SearchParams } from '../../../../../lib/gateway-api/page-api';

export default async function RoutingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeRoutingPage searchParams={await searchParams} />;
}
