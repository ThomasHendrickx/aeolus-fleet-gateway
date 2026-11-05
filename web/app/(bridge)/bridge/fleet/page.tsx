import { BridgeFleetPage } from '../../../../features/bridge/fleet/state/bridge-fleet';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export default async function BridgeFleetRoute({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeFleetPage searchParams={await searchParams} />;
}
