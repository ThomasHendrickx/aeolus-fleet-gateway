import { BridgeHomePage } from '../../../features/bridge/state/bridge-home';
import type { SearchParams } from '../../../lib/gateway-api/page-api';

export default async function BridgePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeHomePage searchParams={await searchParams} />;
}
