import { BridgeMessagesPage } from '../../../../features/bridge/state/bridge-messages';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export default async function MessagesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeMessagesPage searchParams={await searchParams} />;
}
