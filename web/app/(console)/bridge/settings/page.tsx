import type { Metadata } from 'next';

import { BridgeSettingsPage } from '../../../../features/bridge/state/bridge-settings';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Bridge settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeSettingsPage searchParams={await searchParams} />;
}
