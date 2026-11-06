import { BridgeSettingsPage } from '../../../../features/bridge/state/bridge-settings';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeSettingsPage searchParams={await searchParams} />;
}
