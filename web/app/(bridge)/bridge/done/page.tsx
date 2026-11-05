import { BridgeDonePage } from '../../../../features/bridge/state/bridge-done';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export default async function DonePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeDonePage searchParams={await searchParams} />;
}
