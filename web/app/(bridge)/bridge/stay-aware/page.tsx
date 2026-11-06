import { BridgeStayAwarePage } from '../../../../features/bridge/state/bridge-stay-aware';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export default async function StayAwarePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeStayAwarePage searchParams={await searchParams} />;
}
